import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callSync, callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import {
  animateClip,
  characterElement,
  clipModelFor,
  clipRate,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
} from "./lib/klingClip";
import { resolveRosterPersona } from "./lib/roster";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { countWords } from "./lib/wordBudget";
import { GROUNDING_RULES } from "./lib/grounding";
import { businessContext } from "./lib/businessContext";

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
 *   copy     P1  write ONE story, then break it into shots
 *   scene    P2  stage each shot's first frame against a locked establishing frame
 *   clip     P3  animate each shot, the character locked and the cut chained
 *   speech   P4  voice each shot's line
 *   captions P8  stitch, voice and caption (always renders; captions only
 *                when the step is planned, i.e. Caption overlay is on)
 *
 * Each stage reads the previous stage's shots and adds its own field, the
 * same chain Video Animation uses, so every shot's frame, clip, line and
 * audio always belong together.
 *
 * The first cut of this format produced a disconnected montage with mangled
 * hands, for three reasons now designed out:
 *
 *  - the writer was told to VARY the setting between shots, so every shot
 *    was a new place. It now writes one premise in one locked location and
 *    each shot is a beat of it.
 *  - every frame was staged independently from the character sheet alone, so
 *    the set and light drifted. Shot 1 is now staged first and handed to the
 *    rest as the establishing frame.
 *  - clips were animated by vidu turbo, which takes no negative prompt, no
 *    character reference and no end frame, so nothing held the anatomy or
 *    joined one shot to the next. Kling v3 takes all three.
 */

/** The reference clips are ~5s takes; a shot's length is spread from the duration. */
const TARGET_SHOT_SECONDS = 5;
/** Measured on the narration voice (see wordBudget.ts). */
const WORDS_PER_SEC = 2.3;

/**
 * Staging is nano-banana-2/edit rather than qwen-image-3/edit: twice the
 * price per frame, but it holds a character across several reference images
 * and draws hands far better, and a bad frame costs a whole clip to animate.
 * It is what Drama already stages its storyboard frames with.
 */
const STAGE_MODEL = "fal-ai/nano-banana-2/edit";
const STAGE_PRICE_PER_IMAGE = 0.08;

/**
 * The clip step lives in lib/klingClip.ts now, shared with every other
 * animating format. A skeleton's hands are 27 bones with nothing between
 * them -- the hardest thing in frame for any of these models to keep honest
 * -- so on top of that module's negative prompt this format also has a
 * planner that only ever gives the hands something to hold (see PLAN_SYSTEM).
 */
const DEFAULT_CHARACTER_MODEL = "fal-ai/nano-banana-2";
const DEFAULT_CHARACTER_PRICE = 0.08;
const TTS_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";
const TTS_PRICE_PER_1000_CHARS = 0.1;
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

/**
 * Whole seconds per shot, adding up to the duration, every shot inside the
 * clip model's own 3--15s range. The default count is mirrored in
 * src/lib/estimate.ts, which prices one staged frame per shot.
 */
function shotLengths(duration: number, count?: number): number[] {
  const total = Math.max(MIN_CLIP_SECONDS, Math.round(duration));
  // At least enough shots that none runs past the ceiling, and never so many
  // that one falls under the floor.
  const most = Math.max(1, Math.floor(total / MIN_CLIP_SECONDS));
  const fewest = Math.ceil(total / MAX_CLIP_SECONDS);
  const wanted = count ?? Math.max(1, Math.round(total / TARGET_SHOT_SECONDS));
  const n = Math.min(most, Math.max(fewest, wanted));
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total % n ? 1 : 0));
}

type Look = "bare" | "costume" | "glass";
type ShotSize = "wide" | "medium" | "close";

interface Shot {
  line: string;
  /** What this shot changes in the story -- kept for the remix panel to show. */
  beat: string;
  action: string;
  /** What the hands hold or rest on. Never nothing: see PLAN_SYSTEM. */
  hands: string;
  shotSize: ShotSize;
  look: Look;
  glow?: string;
  /** Only set when the story deliberately moves off the locked location. */
  setting?: string;
  /** True when this shot carries straight on from the one before it. */
  continuous: boolean;
  camera: string;
  seconds: number;
  frameUrl?: string;
  clipUrl?: string;
  audioUrl?: string;
}

/** The parts of the plan that are fixed once and shared by every shot. */
interface Spine {
  premise: string;
  location: string;
  lighting: string;
  wardrobe?: string;
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
  videoModel?: string;
  mentionBusiness?: boolean;
}

const cfgOf = (job: Doc<"jobs">) => job.config as SkeletonConfig;
const shotsOf = (job: Doc<"jobs">, stepId: string): Shot[] =>
  ((job.steps.find((s) => s.id === stepId)?.output as { shots?: Shot[] } | undefined)?.shots ??
    []) as Shot[];
const spineOf = (job: Doc<"jobs">, stepId: string): Spine =>
  ((job.steps.find((s) => s.id === stepId)?.output as { spine?: Spine } | undefined)?.spine ?? {
    premise: "",
    location: "",
    lighting: "",
  }) as Spine;


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
  "no text or logos. Plain soft gray studio background, soft key light with a gentle rim " +
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
  if (character) return resolveRosterPersona(ctx, character, { clientId, jobId });

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
    () => "A photoreal 3D human skeleton standing, facing the camera, plain gray background.",
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
is the main character and acts the topic out.

You are writing ONE continuous scene, not a montage. Decide the story first,
then break it into shots. A viewer must be able to follow it: the skeleton is
in one place, doing one thing, and the shots are consecutive moments of it.

First the spine, which is fixed for the whole video:
- premise: the story in one sentence, with a beginning, a turn and a payoff.
  Something actually happens and it ends differently from how it started.
- location: ONE specific real-world place, described richly enough to build:
  the room, the surfaces, the props on them, the time of day, what is out of
  the window. Every shot happens here.
- lighting: one motivated lighting setup for that place, held all the way
  through -- warm lamplight and a cold window, neon through blinds,
  golden-hour sun across a table.
- wardrobe: what the skeleton wears for the ENTIRE video, or "none" if it is
  bare. It never changes mid-story.

Then the shots, each one a consecutive beat of that story:
- beat: what changes in the story in this shot. Shot 1 sets it up, the middle
  shots turn it, the last one pays it off.
- line: the voiceover spoken over this shot. Punchy and concrete, within the
  word limit you're given -- it is what fits the shot when read aloud. The
  first line is the hook. Read end to end, the lines must be one argument,
  each following from the last.
- action: ONE clear physical action the skeleton performs, readable in a few
  seconds. Make it a visual gag that proves the point whenever you can: soda
  pouring straight through its ribcage onto the table. The skeleton acts.
- hands: what the skeleton's hands are holding, gripping or resting on in
  this shot -- a mug, a pan handle, the edge of the counter, its own jaw.
  NEVER leave the hands empty in mid-air and never say "gesturing": bone
  hands with nothing to hold come out deformed. If the action has no natural
  prop, rest them on a surface or put them in pockets, behind the back or
  out of frame, and say so here.
- shotSize: "wide" (the whole body in the room), "medium" (waist up) or
  "close" (skull and shoulders). Vary these -- consecutive identical sizes
  look static. Prefer "close" for emotional beats, and note that hands are
  usually out of frame in a close shot, which is a good way to spend a beat.
- continuous: true if this shot carries straight on from the one before --
  same moment, camera repositioned. false only for a deliberate time cut
  ("an hour later"). Most shots should be true.
- setting: leave this out. Only fill it if the story genuinely moves to
  another room, and then say where.
- look: "bare" (the character as it is), "costume" (wearing the wardrobe
  above) or "glass" (inside a clear, glass-like human body shell). Use
  "glass" for anything about the body, organs, pain or health, and name in
  glow the part that lights up (stomach, throat, heart, knee, brain). Keep
  it the same across shots unless the story is about the change.
- camera: one continuous move -- slow push-in, tracking back as it walks
  toward camera, slow orbit, a tilt down to the hands.

No on-screen text. If a product is part of the brief, it is a real prop the
skeleton uses, never a floating product shot. Avoid stock ad filler ("in
today's world", "game-changer").

${GROUNDING_RULES}`;

const PLAN_TOOL = {
  name: "save_shots",
  description: "Save the story spine and the shot-by-shot script.",
  input_schema: {
    type: "object",
    properties: {
      premise: { type: "string" },
      location: { type: "string" },
      lighting: { type: "string" },
      wardrobe: { type: "string" },
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            beat: { type: "string" },
            line: { type: "string" },
            action: { type: "string" },
            hands: { type: "string" },
            shotSize: { type: "string", enum: ["wide", "medium", "close"] },
            continuous: { type: "boolean" },
            setting: { type: "string" },
            look: { type: "string", enum: ["bare", "costume", "glass"] },
            glow: { type: "string" },
            camera: { type: "string" },
          },
          required: [
            "beat",
            "line",
            "action",
            "hands",
            "shotSize",
            "continuous",
            "look",
            "camera",
          ],
        },
      },
    },
    required: ["premise", "location", "lighting", "shots"],
  },
};

type PlannedShot = Omit<Shot, "seconds" | "continuous"> & { continuous?: boolean };
interface PlanResult extends Partial<Spine> {
  shots?: PlannedShot[];
}

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
      ? (await resolveRosterPersona(ctx, cfg.character, { clientId, jobId })).description
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
      .join("\n") + (await businessContext(ctx, clientId, cfg.mentionBusiness));

    const read = (value: unknown): PlanResult => (value as PlanResult | null) ?? {};
    const readShots = (plan: PlanResult): PlannedShot[] =>
      (plan.shots ?? []).filter(
        (s) => s && typeof s.line === "string" && typeof s.action === "string",
      );
    const overLimit = (shots: PlannedShot[]) =>
      !written &&
      (shots.length !== lengths.length ||
        shots.some((s, i) => countWords(s.line) > (limits[i] ?? limits[limits.length - 1])));

    let call = await callTool(PLAN_SYSTEM, userPrompt, PLAN_TOOL);
    let inputTokens = call.inputTokens;
    let outputTokens = call.outputTokens;
    let plan = read(call.value);
    let planned = readShots(plan);
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
      const retriedPlan = read(call.value);
      const retried = readShots(retriedPlan);
      if (retried.length) {
        plan = retriedPlan;
        planned = retried;
      }
    }
    if (!planned.length) throw new Error("model returned no shots");

    // Shot lengths follow the count the model actually returned, so the
    // animation still adds up to the requested duration.
    const actual =
      planned.length === lengths.length ? lengths : shotLengths(cfg.duration ?? 30, planned.length);
    planned = planned.slice(0, actual.length);
    const spine: Spine = {
      premise: (plan.premise ?? "").trim(),
      location: (plan.location ?? "").trim(),
      lighting: (plan.lighting ?? "").trim(),
      wardrobe: /^(none|n\/a|nothing)$/i.test((plan.wardrobe ?? "").trim())
        ? undefined
        : plan.wardrobe?.trim() || undefined,
    };
    const shots: Shot[] = planned.map((s, i) => ({
      line: s.line.trim(),
      beat: s.beat?.trim() || "",
      action: s.action,
      // A blank `hands` is the failure this field exists to prevent, so it
      // falls back to the safest answer rather than to nothing.
      hands: s.hands?.trim() || "resting on the nearest surface",
      shotSize: (["wide", "medium", "close"] as const).includes(s.shotSize) ? s.shotSize : "medium",
      look: (["bare", "costume", "glass"] as const).includes(s.look) ? s.look : "bare",
      glow: s.glow?.trim() || undefined,
      setting: s.setting?.trim() || undefined,
      // Shot 1 has nothing to carry on from; after that, continuity is the
      // default and a cut has to be asked for.
      continuous: i > 0 && s.continuous !== false,
      camera: s.camera,
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
      output: { text: shots.map((s) => s.line).join(" "), spine, shots },
    });
    return null;
  },
});

// ---------------------------------------------------------------- P2: stage each shot

function lookText(shot: Shot, spine: Spine): string {
  if (shot.look === "glass") {
    return (
      "The skeleton is inside a clear, glass-like transparent human body shell, its bones " +
      "fully visible through it" +
      (shot.glow ? `, with a warm light glowing inside at the ${shot.glow}.` : ".")
    );
  }
  // The wardrobe is the spine's, not the shot's: it is the same garment in
  // every shot or the video stops looking like one scene.
  if (shot.look === "costume" && spine.wardrobe) return `The skeleton wears ${spine.wardrobe}.`;
  return "The skeleton appears exactly as it does in its reference.";
}

const SHOT_SIZES: Record<ShotSize, string> = {
  wide: "Wide shot: the whole skeleton in the room, the set around it readable.",
  medium: "Medium shot: the skeleton from the waist up.",
  close: "Close shot: the skull and shoulders fill the frame.",
};

/**
 * Hands are the format's weak point, so every frame is told what they are
 * doing rather than left to invent it -- and in a close shot the honest
 * answer is usually that they are outside the frame.
 */
function handsText(shot: Shot): string {
  if (shot.shotSize === "close") {
    return (
      `The hands are out of frame, or only one is visible and it is ${shot.hands}. ` +
      "Any visible hand is complete and anatomically correct, with exactly five finger bones."
    );
  }
  return (
    `Both hands are ${shot.hands} -- in firm contact with it, never open in empty air. ` +
    "Each hand is complete and anatomically correct, with exactly five finger bones, " +
    "clearly separated and correctly jointed."
  );
}

export const stageShots = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = cfgOf(job);
    const shots = shotsOf(job, "copy");
    const spine = spineOf(job, "copy");
    if (!shots.length) throw new Error("no shots to stage");

    const character = await characterReference(ctx, jobId, clientId, cfg.character);
    let productUrl: string | null = null;
    if (cfg.productImage) {
      const asset = await ctx.runQuery(internal.assets.getInternal, { assetId: cfg.productImage });
      productUrl = asset ? await ctx.storage.getUrl(asset.storageId) : null;
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: shots.length * STAGE_PRICE_PER_IMAGE,
    });

    /**
     * Numbered references, built per shot because the list is: the character
     * sheet, then the establishing frame once there is one, then the product.
     * nano-banana-2/edit takes up to 14, so they always fit.
     */
    const frameOf = async (shot: Shot, i: number, establishing: string | null): Promise<string> => {
      const urls = [character.imageUrl];
      if (establishing) urls.push(establishing);
      if (productUrl) urls.push(productUrl);
      const n = (url: string) => `Image ${urls.indexOf(url) + 1}`;

      const refs =
        `${n(character.imageUrl)} is the main character, ${character.description}: keep its ` +
        "exact design -- bones, eyes, proportions and any accessories or markings it has. " +
        (establishing
          ? `${n(establishing)} is an earlier shot of THIS SAME SCENE: reuse that exact set, ` +
            "the same props in the same places, the same wall and floor, the same time of day " +
            "and the same light. This is a new camera angle on it, not a new location. "
          : "") +
        (productUrl
          ? `${n(productUrl)} is a real product: it appears as a prop the skeleton uses, true ` +
            "to its shape and label. "
          : "");

      const wrap = (moment: string) =>
        "Photoreal cinematic 3D film still, vertical 9:16 frame. " +
        refs +
        `${lookText(shot, spine)} ` +
        `Setting: ${shot.setting ?? spine.location}. ` +
        `${SHOT_SIZES[shot.shotSize]} ${moment} ${handsText(shot)} ` +
        `Lighting: ${spine.lighting}. Shallow depth of field, rich set detail, filmic color. ` +
        "No captions, no watermark, no UI.";

      const result = (await submitWithContentPolicyFallback(
        STAGE_MODEL,
        (prompt) => ({
          prompt,
          image_urls: urls,
          aspect_ratio: "9:16",
          output_format: "jpeg",
          safety_tolerance: "4",
          num_images: 1,
        }),
        wrap(`The moment this action begins: ${shot.action}.`),
        () => wrap("The skeleton stands in the scene."),
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
      return frameUrl;
    };

    // Shot 1 is staged alone and becomes the establishing frame every other
    // shot is built against -- which is what stops the set and the light
    // drifting from shot to shot. The rest still run in parallel: chaining
    // each to its immediate predecessor would serialise a 60s video into a
    // dozen round trips and compound any drift rather than anchoring it.
    const establishing = await frameOf(shots[0], 0, null);
    const rest = await Promise.all(
      shots.slice(1).map(async (shot, i) => ({
        ...shot,
        frameUrl: await frameOf(shot, i + 1, establishing),
      })),
    );
    const staged: Shot[] = [{ ...shots[0], frameUrl: establishing }, ...rest];

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
    const cfg = cfgOf(job);
    const shots = shotsOf(job, "scene");
    if (!shots.length) throw new Error("no staged shots to animate");

    const model = clipModelFor(cfg.videoModel);
    const rate = clipRate(model);
    const seconds = shots.reduce((sum, s) => sum + s.seconds, 0);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: seconds * rate,
    });

    // The character sheet rides along on every shot as @Element1, so the
    // skeleton is held to one design for the whole video rather than only
    // to whatever the opening frame happened to show.
    const character = await characterReference(ctx, jobId, clientId, cfg.character);

    const animated = await Promise.all(
      shots.map(async (shot, i) => {
        if (!shot.frameUrl) throw new Error(`shot ${i + 1} has no frame to animate`);
        // When the next shot carries straight on, this clip is made to LAND
        // on its opening frame. That is what turns a pile of clips into a
        // scene: the cut is a match cut instead of a jump.
        const next = shots[i + 1];
        const endFrame = next?.continuous ? next.frameUrl : undefined;

        const clipUrl = await animateClip({
          model,
          startImageUrl: shot.frameUrl,
          endImageUrl: endFrame,
          // The character sheet head-on, plus this shot's staged frame as the
          // same character seen in the scene.
          elements: [characterElement(character.imageUrl, shot.frameUrl)],
          seconds: shot.seconds,
          prompt:
            `The skeleton is @Element1 and keeps that exact design throughout. ${shot.action}. ` +
            `Its hands stay ${shot.hands} and in contact with it for the whole shot; ` +
            "fingers stay whole, separate and correctly jointed, and never pass through solid " +
            "objects. " +
            `Camera: ${shot.camera}, one continuous take. ` +
            (shot.look === "glass" && shot.glow ? `The glow at the ${shot.glow} pulses. ` : "") +
            (endFrame ? "The shot settles into its final framing at the end. " : "") +
            "It moves with natural, weighty, expressive body language; liquids, cloth and props " +
            "follow real physics. The set, props and lighting stay exactly as they start.",
          minimalPrompt: () =>
            `The skeleton performs the action in the scene. Camera: ${shot.camera}. ` +
            "Keep the composition and the character's design consistent.",
        });
        return { ...shot, clipUrl };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P3",
      model,
      units: seconds,
      unitLabel: "seconds",
      costUsd: seconds * rate,
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
