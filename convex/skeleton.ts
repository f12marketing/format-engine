import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callSync, callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import { resolveRosterPersona } from "./lib/roster";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { countWords } from "./lib/wordBudget";

/**
 * Skeleton: a photoreal skeleton is the main character and acts the topic
 * out, one short cinematic shot per line of narration.
 *
 * Modelled on the client's own reference clips (19 Sept 2026): a single
 * recurring skeleton, each ~5s shot one continuous take with a deliberate
 * camera move, the skeleton performing ONE action that dramatises the point
 * -- often a visual gag (soda pouring straight through its ribcage) -- in a
 * detailed, cinematically lit real-world set. For anything about the body it
 * sits inside a clear glass body shell with the relevant part glowing. The
 * old version composited a product into a flat "clinical or classroom" scene
 * and animated it with "gentle motion", which looked nothing like that.
 *
 *   copy     P1  write the narration as shots, and plan each shot's visuals
 *   scene    P2  stage each shot's first frame around the character reference
 *   clip     P3  animate each shot with its action and camera move
 *   speech   P4  voice each shot's line
 *   captions P8  stitch, voice and caption (always renders; captions only
 *                when the step is planned, i.e. Caption overlay is on)
 *
 * Each stage reads the previous stage's shots and adds its own field, the
 * same chain Video Animation uses, so every shot's frame, clip, line and
 * audio always belong together.
 */

/** The reference clips are ~5s takes; a shot's length is spread from the duration. */
const TARGET_SHOT_SECONDS = 5;
/** Measured on the narration voice (see wordBudget.ts). */
const WORDS_PER_SEC = 2.3;

const STAGE_MODEL = "alibaba/qwen-image-3/edit";
const STAGE_PRICE_PER_IMAGE = 0.04;
const CLIP_MODEL = "fal-ai/vidu/q3/image-to-video/turbo";
const CLIP_PRICE_PER_SEC = 0.077; // 720p
const DEFAULT_CHARACTER_MODEL = "fal-ai/nano-banana-2";
const DEFAULT_CHARACTER_PRICE = 0.08;
const TTS_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";
const TTS_PRICE_PER_1000_CHARS = 0.1;
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

/**
 * Whole seconds per shot, adding up to the duration. The default count is
 * mirrored in src/lib/estimate.ts, which prices one staged frame per shot.
 */
function shotLengths(duration: number, count?: number): number[] {
  const total = Math.max(1, Math.round(duration));
  const n = Math.min(total, count ?? Math.max(1, Math.round(total / TARGET_SHOT_SECONDS)));
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0));
}

type Look = "bare" | "costume" | "glass";

interface Shot {
  line: string;
  setting: string;
  action: string;
  look: Look;
  costume?: string;
  glow?: string;
  camera: string;
  lighting: string;
  seconds: number;
  frameUrl?: string;
  clipUrl?: string;
  audioUrl?: string;
}

interface SkeletonConfig {
  prompt?: string;
  narration?: string;
  duration?: number;
  style?: string;
  language?: string;
  character?: string;
  productImage?: Id<"assets">;
  captionStyle?: string;
  mentionBusiness?: boolean;
}

const cfgOf = (job: Doc<"jobs">) => job.config as SkeletonConfig;
const shotsOf = (job: Doc<"jobs">, stepId: string): Shot[] =>
  ((job.steps.find((s) => s.id === stepId)?.output as { shots?: Shot[] } | undefined)?.shots ??
    []) as Shot[];

// ---------------------------------------------------------------- the character

/**
 * With no character picked, every video uses the same default skeleton: the
 * reference clips' character minus their sweatband and branding. Generated
 * once per deployment and kept, so it doesn't drift from video to video.
 */
const DEFAULT_CHARACTER_KEY = "skeleton-default-v1";
const DEFAULT_CHARACTER_DESCRIPTION =
  "a friendly, photoreal human skeleton with smooth ivory bones and big expressive eyeballs " +
  "in its eye sockets, no clothing or accessories";
const DEFAULT_CHARACTER_PROMPT =
  "Full-body character reference of a photoreal 3D human skeleton standing in a relaxed, " +
  "friendly pose, facing the camera. Smooth, clean ivory-cream bones with subtle realistic " +
  "texture, anatomically accurate ribcage, spine and pelvis, and big, glossy, expressive " +
  "human eyeballs set in the eye sockets. No clothing, no hat, no headband, no accessories, " +
  "no text or logos. Plain soft grey studio background, soft key light with a gentle rim " +
  "light, high-end cinematic 3D render, sharp focus.";

export const houseImage = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    ctx.db
      .query("houseImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first(),
});

export const saveHouseImage = internalMutation({
  args: { key: v.string(), storageId: v.id("_storage"), mimeType: v.string() },
  handler: async (ctx, args) => {
    // Two first runs at once both generate; the earlier row wins on read.
    await ctx.db.insert("houseImages", { ...args, addedAt: Date.now() });
  },
});

async function characterReference(
  ctx: ActionCtx,
  jobId: Id<"jobs">,
  clientId: Id<"clients">,
  character: string | undefined,
): Promise<{ imageUrl: string; description: string }> {
  if (character) return resolveRosterPersona(ctx, character);

  const existing = await ctx.runQuery(internal.skeleton.houseImage, { key: DEFAULT_CHARACTER_KEY });
  const existingUrl = existing ? await ctx.storage.getUrl(existing.storageId) : null;
  if (existingUrl) return { imageUrl: existingUrl, description: DEFAULT_CHARACTER_DESCRIPTION };

  await ctx.runMutation(internal.ledger.assertUnderCap, {
    clientId,
    aboutToSpendUsd: DEFAULT_CHARACTER_PRICE,
  });
  const result = (await submitWithContentPolicyFallback(
    DEFAULT_CHARACTER_MODEL,
    (prompt) => ({ prompt, aspect_ratio: "3:4", num_images: 1 }),
    DEFAULT_CHARACTER_PROMPT,
    () => "A photoreal 3D human skeleton standing, facing the camera, plain grey background.",
  )) as { images?: { url?: string }[] };
  const url = result.images?.[0]?.url;
  if (!url) throw new Error("no default character image returned");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch the default character: ${res.status}`);
  const storageId = await ctx.storage.store(
    new Blob([new Uint8Array(await res.arrayBuffer())], { type: "image/png" }),
  );
  await ctx.runMutation(internal.skeleton.saveHouseImage, {
    key: DEFAULT_CHARACTER_KEY,
    storageId,
    mimeType: "image/png",
  });
  // The one-off cost lands on whichever job first needed it.
  await ctx.runMutation(internal.ledger.record, {
    clientId,
    jobId,
    stepId: "scene",
    primitive: "P2",
    model: DEFAULT_CHARACTER_MODEL,
    units: 1,
    unitLabel: "images",
    costUsd: DEFAULT_CHARACTER_PRICE,
  });
  const storedUrl = await ctx.storage.getUrl(storageId);
  if (!storedUrl) throw new Error("could not read back the default character");
  return { imageUrl: storedUrl, description: DEFAULT_CHARACTER_DESCRIPTION };
}

// ---------------------------------------------------------------- P1: script and shot plan

const PLAN_SYSTEM = `You write and direct a short vertical video in which a photoreal 3D skeleton
is the main character and acts the topic out, one shot per line of voiceover.

For every shot:
- line: the voiceover spoken over this shot. Punchy and concrete, and within
  the word limit you're given -- it is what fits the shot when read aloud.
  The first line is the hook.
- setting: one specific real-world place that dramatises the line, rich
  with props and, where it fits, background people -- a retro diner at night,
  a café street at golden hour, marble temple steps, a bathroom mirror.
- action: ONE clear physical action the skeleton performs, readable within
  the shot. Make it a visual gag that proves the point whenever you can:
  soda pouring straight through its ribcage onto the table, a stomach that
  lights up while it clutches it. The skeleton is always the one acting.
- look: "bare" (the character as it is), "costume" (dressed for the role --
  describe the outfit in costume: an apron, a toga, a lab coat), or "glass"
  (inside a clear, glass-like human body shell). Use "glass" for anything
  about the body, organs, pain or health, and name in glow the body part
  that lights up (stomach, throat, heart, knee, brain).
- camera: one continuous move -- slow push-in, tracking backwards as it walks
  toward camera, over-the-shoulder then pushing into an extreme close-up,
  slow orbit.
- lighting: motivated and cinematic -- neon glow, golden-hour sun, a dark
  studio with rim light, cool bathroom light.

Vary settings between shots unless the story needs continuity. No on-screen
text. If a product is part of the brief, it appears as a real prop the
skeleton uses in the shots where it fits naturally, never as a floating
product shot. Avoid stock ad filler ("in today's world", "game-changer").`;

const PLAN_TOOL = {
  name: "save_shots",
  description: "Save the shot-by-shot script.",
  input_schema: {
    type: "object",
    properties: {
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "string" },
            setting: { type: "string" },
            action: { type: "string" },
            look: { type: "string", enum: ["bare", "costume", "glass"] },
            costume: { type: "string" },
            glow: { type: "string" },
            camera: { type: "string" },
            lighting: { type: "string" },
          },
          required: ["line", "setting", "action", "look", "camera", "lighting"],
        },
      },
    },
    required: ["shots"],
  },
};

type PlannedShot = Omit<Shot, "seconds">;

export const planShots = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = cfgOf(job);

    const brief = (cfg.prompt ?? "").trim();
    const written = (cfg.narration ?? "").trim();
    if (!brief && !written) {
      throw new Error("Write the narration yourself, or give a prompt to generate it from.");
    }
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.05 });

    const lengths = shotLengths(cfg.duration ?? 30);
    const limits = lengths.map((s) => Math.max(3, Math.floor(s * WORDS_PER_SEC)));
    const character = cfg.character
      ? (await resolveRosterPersona(ctx, cfg.character)).description
      : DEFAULT_CHARACTER_DESCRIPTION;

    const userPrompt = [
      brief && `Brief: ${brief}`,
      `Main character: ${character}.`,
      `Shots: exactly ${lengths.length}, lasting ${lengths.join(", ")} seconds.`,
      written
        ? `Use this narration word for word, split across the shots in order: ${written}`
        : `Word limit per line: ${limits.join(", ")} words respectively.`,
      cfg.style && `Tone: ${cfg.style}.`,
      cfg.productImage && "A product image is supplied: feature it as a prop where it fits.",
    ]
      .filter(Boolean)
      .join("\n");

    const read = (value: unknown): PlannedShot[] =>
      ((value as { shots?: PlannedShot[] } | null)?.shots ?? []).filter(
        (s) => s && typeof s.line === "string" && typeof s.action === "string",
      );
    const overLimit = (shots: PlannedShot[]) =>
      !written &&
      (shots.length !== lengths.length ||
        shots.some((s, i) => countWords(s.line) > (limits[i] ?? limits[limits.length - 1])));

    let call = await callTool(PLAN_SYSTEM, userPrompt, PLAN_TOOL);
    let inputTokens = call.inputTokens;
    let outputTokens = call.outputTokens;
    let planned = read(call.value);
    if (!planned.length || overLimit(planned)) {
      call = await callTool(
        PLAN_SYSTEM,
        `${userPrompt}\n\nYour last draft broke the limits: it had ${planned.length} shots with ` +
          `lines of ${planned.map((s) => countWords(s.line)).join(", ")} words. Return exactly ` +
          `${lengths.length} shots, each line within its word limit.`,
        PLAN_TOOL,
      );
      inputTokens += call.inputTokens;
      outputTokens += call.outputTokens;
      const retried = read(call.value);
      if (retried.length) planned = retried;
    }
    if (!planned.length) throw new Error("model returned no shots");

    // Shot lengths follow the count the model actually returned, so the
    // animation still adds up to the requested duration.
    const actual =
      planned.length === lengths.length ? lengths : shotLengths(cfg.duration ?? 30, planned.length);
    planned = planned.slice(0, actual.length);
    const shots: Shot[] = planned.map((s, i) => ({
      line: s.line.trim(),
      setting: s.setting,
      action: s.action,
      look: (["bare", "costume", "glass"] as const).includes(s.look) ? s.look : "bare",
      costume: s.costume?.trim() || undefined,
      glow: s.glow?.trim() || undefined,
      camera: s.camera,
      lighting: s.lighting,
      seconds: actual[i],
    }));

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: inputTokens + outputTokens,
      unitLabel: "tokens",
      costUsd: (inputTokens / 1e6) * LLM_INPUT_PER_1M + (outputTokens / 1e6) * LLM_OUTPUT_PER_1M,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      // `text` is the key every format's copy step shares.
      output: { text: shots.map((s) => s.line).join(" "), shots },
    });
    return null;
  },
});

// ---------------------------------------------------------------- P2: stage each shot

function lookText(shot: Shot): string {
  if (shot.look === "glass") {
    return (
      "The skeleton is inside a clear, glass-like transparent human body shell, its bones " +
      "fully visible through it" +
      (shot.glow ? `, with a warm light glowing inside at the ${shot.glow}.` : ".")
    );
  }
  if (shot.look === "costume" && shot.costume) return `The skeleton wears ${shot.costume}.`;
  return "The skeleton appears as it does in @image1.";
}

export const stageShots = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = cfgOf(job);
    const shots = shotsOf(job, "copy");
    if (!shots.length) throw new Error("no shots to stage");

    const character = await characterReference(ctx, jobId, clientId, cfg.character);
    let productUrl: string | null = null;
    if (cfg.productImage) {
      const asset = await ctx.runQuery(internal.assets.getInternal, { assetId: cfg.productImage });
      productUrl = asset ? await ctx.storage.getUrl(asset.storageId) : null;
    }
    const imageUrls = productUrl ? [character.imageUrl, productUrl] : [character.imageUrl];

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: shots.length * STAGE_PRICE_PER_IMAGE,
    });

    const staged = await Promise.all(
      shots.map(async (shot, i) => {
        const wrap = (moment: string) =>
          "Photoreal cinematic 3D film still, vertical 9:16 frame. @image1 is the main " +
          `character, ${character.description}: keep its exact design -- bones, eyes and any ` +
          `accessories or markings it has in @image1. ${lookText(shot)} ` +
          `Setting: ${shot.setting}. ${moment} ` +
          (productUrl
            ? "@image2 is a real product: where it fits, it appears in the scene as a prop, " +
              "true to its shape and label. "
            : "") +
          `Lighting: ${shot.lighting}. Shallow depth of field, rich set detail, filmic color. ` +
          "No captions, no watermark, no UI.";
        const result = (await submitWithContentPolicyFallback(
          STAGE_MODEL,
          (prompt) => ({
            prompt,
            image_urls: imageUrls,
            image_size: "portrait_16_9",
            output_format: "jpeg",
            enable_safety_checker: true,
          }),
          wrap(`The moment this action begins: ${shot.action}.`),
          () => wrap("The skeleton is in the scene, mid-gesture."),
        )) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no frame returned for shot ${i + 1}`);
        // Kept in storage, not as fal's URL, so a remix can still read it.
        const res = await fetch(url);
        if (!res.ok) throw new Error(`failed to fetch frame ${i + 1}: ${res.status}`);
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(await res.arrayBuffer())], { type: "image/jpeg" }),
        );
        const frameUrl = await ctx.storage.getUrl(storageId);
        if (!frameUrl) throw new Error(`could not read back frame ${i + 1}`);
        return { ...shot, frameUrl };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scene",
      primitive: "P2",
      model: STAGE_MODEL,
      units: staged.length,
      unitLabel: "images",
      costUsd: staged.length * STAGE_PRICE_PER_IMAGE,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scene",
      state: "done",
      output: { shots: staged },
    });
    return null;
  },
});

// ---------------------------------------------------------------- P3: animate each shot

export const animateShots = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const shots = shotsOf(job, "scene");
    if (!shots.length) throw new Error("no staged shots to animate");

    const seconds = shots.reduce((sum, s) => sum + s.seconds, 0);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: seconds * CLIP_PRICE_PER_SEC,
    });

    const animated = await Promise.all(
      shots.map(async (shot, i) => {
        if (!shot.frameUrl) throw new Error(`shot ${i + 1} has no frame to animate`);
        const result = (await submitWithContentPolicyFallback(
          CLIP_MODEL,
          (prompt) => ({
            prompt,
            image_url: shot.frameUrl,
            duration: shot.seconds,
            resolution: "720p",
            audio: false, // the narration is laid on in the render
          }),
          `${shot.action}. Camera: ${shot.camera}, one continuous take. ` +
            (shot.look === "glass" && shot.glow ? `The glow at the ${shot.glow} pulses. ` : "") +
            "The skeleton moves with natural, weighty, expressive body language; liquids, cloth " +
            "and props follow real physics. Keep the skeleton's design consistent, with no " +
            "morphing, melting or extra limbs.",
          () =>
            `The skeleton performs the action in the scene. Camera: ${shot.camera}. ` +
            "Keep the composition and the character's design consistent.",
          { timeoutMs: 8 * 60_000 },
        )) as { video?: { url?: string } };
        const clipUrl = result.video?.url;
        if (!clipUrl) throw new Error(`no clip returned for shot ${i + 1}`);
        return { ...shot, clipUrl };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P3",
      model: CLIP_MODEL,
      units: seconds,
      unitLabel: "seconds",
      costUsd: seconds * CLIP_PRICE_PER_SEC,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clip",
      state: "done",
      output: { shots: animated },
    });
    return null;
  },
});

// ---------------------------------------------------------------- P4: voice each line

export const voiceShots = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "speech", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = cfgOf(job);
    const shots = shotsOf(job, "clip");
    if (!shots.length) throw new Error("no animated shots to voice");

    const chars = shots.reduce((sum, s) => sum + s.line.length, 0);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: (chars / 1000) * TTS_PRICE_PER_1000_CHARS * 1.2,
    });

    // One call per shot, so each line's audio lines up with its own clip.
    const voiced = await Promise.all(
      shots.map(async (shot, i) => {
        if (!shot.line.trim()) return shot;
        const result = (await callSync(TTS_MODEL, {
          text: shot.line,
          voice: "Sarah",
          stability: 0.5,
          language_code: cfg.language ?? "en",
          apply_text_normalization: "auto",
        })) as { audio?: { url?: string } };
        const audioUrl = result.audio?.url;
        if (!audioUrl) throw new Error(`no audio returned for shot ${i + 1}`);
        return { ...shot, audioUrl };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "speech",
      primitive: "P4",
      model: TTS_MODEL,
      units: chars,
      unitLabel: "characters",
      costUsd: (chars / 1000) * TTS_PRICE_PER_1000_CHARS,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "speech",
      state: "done",
      output: { shots: voiced },
    });
    return null;
  },
});

// ---------------------------------------------------------------- P8: stitch, voice, caption

export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "captions", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = cfgOf(job);
    const shots = shotsOf(job, "speech");
    if (!shots.length) throw new Error("no voiced shots to render");

    // Always rendered -- this is what produces the video. Captions only when
    // the job planned a captions step (Caption overlay on).
    const captioned = job.steps.some((s) => s.id === "captions");
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${renderServiceBase()}/render/video-animation`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        shots: shots.map((s) => ({
          videoUrl: s.clipUrl,
          audioUrl: s.audioUrl ?? null,
          durationSec: s.seconds,
          caption: captioned ? s.line || null : null,
        })),
        dimensions: "9:16",
        captionStyle: cfg.captionStyle ?? "Classic",
        // A line that runs past its shot holds the last frame, not cut off.
        extendToAudio: true,
        uploadUrl,
      }),
    });
    if (!res.ok) throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    const out = (await res.json()) as {
      width: number;
      height: number;
      storageId: Id<"_storage">;
      bytes: number;
      contentType: string;
    };

    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      producedByJobId: jobId,
      storageId: out.storageId,
      mimeType: out.contentType,
      bytes: out.bytes,
      width: out.width,
      height: out.height,
    });
    if (captioned) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "captions",
        primitive: "P8",
        model: "ffmpeg",
        units: 1,
        unitLabel: "renders",
        costUsd: 0,
      });
      await ctx.runMutation(internal.jobs.patchStep, {
        jobId,
        stepId: "captions",
        state: "done",
        output: { files: [{ name: "output.mp4" }] },
      });
    }
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

// ---------------------------------------------------------------- workflow

export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.skeleton.planShots, args, { retry: true });
      }
      if (planned.includes("scene")) {
        await step.runAction(internal.skeleton.stageShots, args, { retry: true });
      }
      if (planned.includes("clip")) {
        await step.runAction(internal.skeleton.animateShots, args, { retry: true });
      }
      if (planned.includes("speech")) {
        await step.runAction(internal.skeleton.voiceShots, args, { retry: true });
      }
      await step.runAction(internal.skeleton.render, args, { retry: true });
      await step.runMutation(internal.jobs.finish, { jobId: args.jobId, status: "done" });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.skeleton.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
