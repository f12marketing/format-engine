import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { businessBrief } from "./brands";
import { callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import { animateClip, clipModelFor, clipRate, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from "./lib/klingClip";
import { resolveRosterPersona } from "./lib/roster";
import { enforceRateLimit } from "./lib/rateLimit";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { resolveAudioUrl } from "./lib/audioRef";
import { isVideoRef, resolveVideoUrl } from "./lib/videoRef";
import {
  defaultDesign,
  hasText,
  MAX_TEXT_CHARS,
  sanitizeDesign,
  wallLayerHtml,
} from "./lib/wallOfTextDesign";

/**
 * Wall of Text: a casual phone clip with one paragraph of text over it for
 * the whole video -- the confession / "POV:" / question-to-camera post, with
 * the business dropped in the way a user mentions an app they like.
 *
 * P1 writes the paragraph. When the Video field names a person rather than a
 * clip, P2 stages them in a casual front-camera selfie and P3 films it into a
 * short handheld clip -- saved to their videos, so it can be reused. The
 * studio gate then parks the run --
 * suspended, costing nothing -- while the client styles and places the text
 * on the job page; approving it is the studio's Save. The render burns in
 * exactly the design that was approved, drawn by the same style functions
 * the studio previewed it with (lib/wallOfTextDesign.ts).
 */
interface WallConfig {
  prompt?: string;
  mentionBusiness?: boolean;
  /** A person to film (roster ref) or a finished clip ("clip:" / "video:"). */
  video?: string;
  /** Where the filmed person is: a preset, or "Match the text". */
  setting?: string;
  /** Length of a filmed clip, in seconds. */
  duration?: number;
  audio?: string | null;
  /** Set by "Edit again": a finished job's design, reopened in the studio. */
  design?: unknown;
}

export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, {
        jobId: args.jobId,
      });
      if (planned.includes("copy")) {
        await step.runAction(internal.wallOfText.writeText, args, { retry: true });
      }
      if (planned.includes("scene")) {
        await step.runAction(internal.wallOfText.stageSelfie, args, { retry: true });
      }
      if (planned.includes("film")) {
        await step.runAction(internal.wallOfText.filmClip, args, { retry: true });
      }
      if (planned.includes("style")) {
        await step.runAction(internal.wallOfText.openStudio, args, { retry: true });
        await passGate(step, args.jobId, "style");
      }
      await step.runAction(internal.wallOfText.render, args, { retry: true });
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "done",
      });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

async function passGate(step: WorkflowCtx, jobId: Id<"jobs">, stepId: string): Promise<void> {
  await step.awaitEvent({ name: `approve:${jobId}:${stepId}` });
  await step.runMutation(internal.jobs.patchStep, { jobId, stepId, state: "done" });
  await step.runMutation(internal.jobs.setRunning, { jobId });
}

// ---------------------------------------------------------------- P1: copy

/**
 * Written from the ten reference posts: what they have in common is that
 * none of them reads like marketing. A person, a phone, a thought -- and the
 * product, when there is one, is where the thought lands, not a pitch
 * stapled to the end.
 */
const WALL_SYSTEM = `You write the on-screen text for a "wall of text" short-form video: an
unedited phone clip of a person, with one paragraph of text laid over it for
the whole video. The viewer reads it in the 5-10 seconds the clip plays.

How these posts sound:
- First person, like a real person posting from their phone -- never like a
  brand. Casual punctuation; all-lowercase is fine and often better.
- A hook in the first few words: a confession, a "POV:", a question to the
  viewer, "i have an idea", a hot take, a relatable callout.
- Specific over general: real numbers, times, places, small details.
- One thought that builds to a payoff, a question or a punchline at the end.
- 120 to 320 characters. Line breaks only where a person would put them (a
  short list, a beat before the punchline).
- At most one emoji or a "<3" sign-off, at the very end, only if it fits.
- No hashtags, no markdown, no quotation marks around the whole text.

When you are told to mention a business:
- Mention it the way someone mentions an app or shop they actually use --
  "mine is downloading X", "been using X for this" -- mid-thought or near
  the end. Never as an ad, a slogan or a call to action.
- Use only what the business profile says. Never invent prices, results,
  features or claims it doesn't state.`;

const WALL_TOOL = {
  name: "save_wall_text",
  description: "Save the on-screen text.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The paragraph, 120-320 characters." },
      scene: {
        type: "string",
        description:
          "Where the person posting would plausibly be filming themselves while this is on screen, " +
          "and what they are doing -- one short line, e.g. 'sitting in a parked car after work' or " +
          "'on the couch under a blanket'. Ordinary, unglamorous, believable.",
      },
    },
    required: ["text", "scene"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

/**
 * The user turn: the client's brief, plus the business profile when the
 * toggle is on. Shared by the run and the studio's "another take", so a
 * rewrite is written to the same brief as the original.
 */
async function writeFor(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  config: WallConfig,
  avoid?: string,
): Promise<{ text: string; scene: string; costUsd: number; tokens: number }> {
  const brief = (config.prompt ?? "").trim();
  if (!brief) throw new Error("Say what the text should be about.");

  let business = "Do not mention any business, brand or product by name.";
  if (config.mentionBusiness) {
    const brand = await ctx.runQuery(internal.brands.forClientInternal, { clientId });
    if (!brand?.description) {
      throw new Error(
        "Mention your business is on, but there are no business details yet. Add them on the Business page.",
      );
    }
    business = `Business profile:\n${businessBrief(brand)}\n\nMention the business naturally, by name.`;
  }

  const userPrompt = [
    `What the text should be about: ${brief}`,
    business,
    avoid && `Write a genuinely different take from this one -- a new hook, not a reword:\n${avoid}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.02 });
  const call = await callTool(WALL_SYSTEM, userPrompt, WALL_TOOL as never);
  const text = String((call.value as { text?: string })?.text ?? "").trim();
  if (!text) throw new Error("model returned no text");
  // The budget is stated in the prompt; this is the hard ceiling the studio
  // itself enforces, so nothing reaches it that the studio couldn't hold.
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error(`text is ${text.length} chars, over the ${MAX_TEXT_CHARS} limit`);
  }
  return {
    text,
    scene: String((call.value as { scene?: string })?.scene ?? "").trim().slice(0, 200),
    tokens: call.inputTokens + call.outputTokens,
    costUsd:
      (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M,
  };
}

export const writeText = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const { text, scene, costUsd, tokens } = await writeFor(ctx, clientId, job.config as WallConfig);

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: tokens,
      unitLabel: "tokens",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { text, scene },
    });
    return null;
  },
});

/**
 * The studio's "another take" button: a fresh paragraph for the same brief,
 * returned to the browser rather than written onto the job -- the client
 * decides whether to keep it, and Save carries whichever text is on screen.
 */
export const rewrite = action({
  args: { jobId: v.id("jobs"), current: v.optional(v.string()) },
  handler: async (ctx, { jobId, current }): Promise<{ text: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorised. This is an invite-only tool.");

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job || job.clientId !== client._id || job.formatId !== "wall-of-text") {
      throw new Error("job not found");
    }
    if (job.status !== "awaiting_approval") {
      throw new Error("The text can only be rewritten while the video is being edited.");
    }
    await enforceRateLimit(ctx, "rewriteText", client._id);

    const { text, costUsd, tokens } = await writeFor(
      ctx,
      client._id,
      job.config as WallConfig,
      current?.slice(0, MAX_TEXT_CHARS),
    );
    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: tokens,
      unitLabel: "tokens",
      costUsd,
    });
    return { text };
  },
});

// ---------------------------------------------------------------- filming

/**
 * The video the text goes on: the clip this run filmed, or the one the
 * client picked. The filmed clip is an asset of theirs, read back through
 * the same ownership check as any other video.
 */
async function clipUrl(
  ctx: ActionCtx,
  job: { config: unknown; steps: { id: string; output?: unknown }[] },
  clientId: Id<"clients">,
): Promise<string> {
  const filmed = (job.steps.find((s) => s.id === "film")?.output as { assetId?: string } | undefined)
    ?.assetId;
  return resolveVideoUrl(ctx, filmed ? `video:${filmed}` : (job.config as WallConfig).video, clientId);
}

/** The presets on the config panel, as a scene. "Match the text" uses the writer's own suggestion. */
const SETTINGS: Record<string, string> = {
  Bedroom: "sitting on their bed in a lived-in bedroom, soft lamp light",
  Car: "sitting in the driver's seat of a parked car, daylight through the windscreen",
  Kitchen: "leaning on the counter in a home kitchen",
  "Walking outside": "walking along a quiet street, daylight",
  Desk: "sitting at a desk with a laptop in the background",
  Couch: "slumped on a couch in a living room",
};
const FALLBACK_SCENE = SETTINGS.Bedroom;

const SCENE_MODEL = "alibaba/qwen-image-3/edit";
const SCENE_PRICE = 0.04;

/**
 * P2. The picked person, re-shot as the opening frame of a front-camera
 * selfie: phone at arm's length, an ordinary room, available light. The
 * references are all this -- nobody in them is lit or styled -- and a studio
 * portrait animated as it is reads as an ad, not a post.
 */
export const stageSelfie = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as WallConfig;
    if (!config.video || isVideoRef(config.video)) throw new Error("There is nobody to film.");

    const person = await resolveRosterPersona(ctx, config.video, { clientId, jobId });
    const suggested = (job.steps.find((s) => s.id === "copy")?.output as { scene?: string } | undefined)
      ?.scene;
    const where = SETTINGS[config.setting ?? ""] ?? (suggested || FALLBACK_SCENE);

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: SCENE_PRICE * 1.2,
    });

    const wrap = (expression: string) =>
      `@image1 is a person (${person.description}). A vertical 9:16 front-camera selfie of them, ` +
      `phone held at arm's length, ${where}. Casual and unedited, like a frame from a TikTok they ` +
      "are about to post: available light only, slight phone-camera grain, framed from the chest up " +
      `with room above the head, ${expression}. Keep their face and features exactly as in @image1. ` +
      "No text, no captions, no watermark, no phone UI.";

    const result = (await submitWithContentPolicyFallback(
      SCENE_MODEL,
      (prompt) => ({ prompt, image_urls: [person.imageUrl], num_images: 1 }),
      wrap("looking into the lens with a thoughtful, slightly amused expression"),
      () => wrap("looking into the lens with a relaxed expression"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no selfie frame returned");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch the selfie frame: ${res.status}`);
    const storageId = await ctx.storage.store(await res.blob());
    const imageUrl = await ctx.storage.getUrl(storageId);
    if (!imageUrl) throw new Error("could not read back the selfie frame");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scene",
      primitive: "P2",
      model: SCENE_MODEL,
      units: 1,
      unitLabel: "images",
      costUsd: SCENE_PRICE,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scene",
      state: "done",
      output: { imageUrl, scene: where },
    });
    return null;
  },
});

/**
 * P3. The frame, animated into a few seconds of someone holding their phone
 * while the text is on screen: a little sway, a blink, a glance. Not talking
 * -- the text is the voice here, and a moving mouth with nothing to say reads
 * as broken. Kept as one of the client's videos, so the same clip can carry a
 * different paragraph later without paying to film it again.
 */
export const filmClip = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "film", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as WallConfig;
    const frame = (job.steps.find((s) => s.id === "scene")?.output as { imageUrl?: string } | undefined)
      ?.imageUrl;
    if (!frame) throw new Error("no selfie frame to film");

    const seconds = Math.min(
      MAX_CLIP_SECONDS,
      Math.max(MIN_CLIP_SECONDS, Math.round(config.duration ?? 6)),
    );
    const model = clipModelFor(undefined);
    const costUsd = seconds * clipRate(model);
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd * 1.1 });

    const clip = await animateClip({
      model,
      startImageUrl: frame,
      seconds,
      prompt:
        "Handheld front-camera selfie video. The person holds the phone at arm's length with small, " +
        "natural hand-held sway; they blink, glance at the lens and away, shift their weight slightly " +
        "and make small, real facial expressions. Mouth closed or barely moving -- they are not " +
        "talking. Keep the face, the room and the light exactly as in the opening frame, with no " +
        "warping or morphing.",
      minimalPrompt: () =>
        "Subtle handheld camera sway and natural small movements. Keep everything exactly as in " +
        "the opening frame.",
    });

    const res = await fetch(clip);
    if (!res.ok) throw new Error(`failed to fetch the filmed clip: ${res.status}`);
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    // Recorded as the client's own video (no producedByJobId), so it shows up
    // in the Videos tab for reuse -- and not as this job's deliverable, which
    // is the rendered video with the text on it.
    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      storageId,
      mimeType: "video/mp4",
      bytes: blob.size,
      durationSec: seconds,
    });

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "film",
      primitive: "P3",
      model,
      units: seconds,
      unitLabel: "seconds",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "film",
      state: "done",
      output: { assetId, durationSec: seconds },
    });
    return null;
  },
});

// ---------------------------------------------------------------- studio gate

/**
 * Parks the run at the studio with a starting design: the reference look
 * around the text P1 wrote, or -- for "Edit again" -- the design the last
 * render was made from. The URLs are for the preview only; the render
 * re-resolves both from the config, because an approved output is whatever
 * the browser sent back.
 */
export const openStudio = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "style", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as WallConfig;

    const written = (job.steps.find((s) => s.id === "copy")?.output as
      | { text?: string }
      | undefined)?.text;
    const design = config.design
      ? sanitizeDesign(config.design)
      : defaultDesign((written ?? "").trim());

    const videoUrl = await clipUrl(ctx, job, clientId);
    const audioUrl = await resolveAudioUrl(ctx, config.audio ?? null, clientId);

    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "style",
      output: { design, videoUrl, audioUrl },
    });
    return null;
  },
});

// ---------------------------------------------------------------- render

/** Longer than any of the references by a distance; a cap on what one render may encode. */
const MAX_DURATION_SEC = 60;

export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "render", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as WallConfig;

    const approved = job.steps.find((s) => s.id === "style")?.output as
      | { design?: unknown }
      | undefined;
    const design = sanitizeDesign(approved?.design);
    if (!hasText(design)) throw new Error("There is no text to put on the video.");

    const videoUrl = await clipUrl(ctx, job, clientId);
    // No audio chosen means the clip keeps its own sound, as every reference does.
    const audioUrl = await resolveAudioUrl(ctx, config.audio ?? null, clientId);

    let overlayUrl: string | null = null;
    if (design.overlay) {
      const asset = await ctx.runQuery(internal.assets.getInternal, {
        assetId: design.overlay.assetId as Id<"assets">,
      });
      // Owner-checked like every other asset read; a bad id drops the overlay
      // rather than failing a render the client has already approved.
      if (asset && asset.clientId === clientId && asset.kind === "image") {
        overlayUrl = await ctx.storage.getUrl(asset.storageId);
      }
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${renderServiceBase()}/render/wall-of-text`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        layerHtml: wallLayerHtml(design, overlayUrl),
        videoUrl,
        audioUrl,
        maxDurationSec: MAX_DURATION_SEC,
        uploadUrl,
      }),
    });
    if (!res.ok) {
      throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    }
    const out = (await res.json()) as {
      width: number;
      height: number;
      storageId?: Id<"_storage">;
      bytes: number;
      contentType: string;
      durationSec?: number;
    };
    if (!out.storageId) {
      throw new Error(
        "The render service is running old code that can't put text on a video. Restart it (cd ../render-service && npm start) and save again.",
      );
    }

    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      producedByJobId: jobId,
      storageId: out.storageId,
      mimeType: out.contentType,
      bytes: out.bytes,
      width: out.width,
      height: out.height,
      durationSec: out.durationSec,
    });
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "render",
      primitive: "P7",
      model: "chrome+ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      output: { files: [{ name: "output.mp4" }], design },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.wallOfText.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
