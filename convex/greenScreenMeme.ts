import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL } from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { businessContext } from "./lib/businessContext";
import { KLIPY_RENDER_BLOCKED, klipyServerRenderApproved } from "./lib/klipyTerms";
import { enforceRateLimit } from "./lib/rateLimit";
import { wallLayerHtml } from "./lib/wallOfTextDesign";
import {
  defaultMemeLayer,
  looksKeyable,
  memeCaptionDesign,
  parseMemePick,
  sanitizeMemeDesign,
  type MemePick,
} from "./lib/memeDesign";

/**
 * Green Screen Meme: the client's own background -- a photo or a video -- with
 * a meme on it and a caption on top.
 *
 * The meme comes from the meme popup: a GIF, clip, sticker, meme or AI emoji
 * from Klipy, or one the client uploaded. The run then parks at the "style"
 * gate, the meme studio -- Wall of Text's studio with the meme as a layer --
 * where the meme is moved, sized, mirrored and keyed, and the caption and any
 * text boxes are edited and styled. `render` makes exactly that.
 *
 * Klipy's media is never stored here: the config keeps the URLs Klipy's API
 * returned, and the render service fetches them as they are for the one
 * render and deletes them after.
 *
 * Jobs from before the studio keyed a trending clip from the clip library
 * over a still, captioned in a fixed style. They planned a "clip" step, and
 * still run the old way -- see the bottom of this file.
 */
interface MemeConfig {
  /** The background: an image or video asset. */
  background?: Id<"assets">;
  /** The meme popup's pick -- see MemePick. */
  meme?: unknown;
  /**
   * The Add captions switch. Off means no caption, even one typed before it
   * was switched off. Unset on jobs from before the switch: captions on.
   */
  captions?: boolean;
  /** The Hook caption box, word for word. Blank asks P1 to write one. */
  caption?: string;
  mentionBusiness?: boolean;
  /** Set by "Edit meme again": a finished job's design, reopened in the studio. */
  design?: unknown;
  // Before the studio.
  trendingClip?: Id<"clips">;
  prompt?: string;
  aspectRatio?: string;
  captionStyle?: string;
}

/** A background video longer than this is cut here. */
const MAX_SECONDS = 60;

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
      if (planned.includes("clip")) {
        // A job from before the studio.
        await step.runAction(internal.greenScreenMeme.fetchClip, args, { retry: true });
        if (planned.includes("copy")) {
          await step.runAction(internal.greenScreenMeme.writeCaption, args, { retry: true });
        }
        await step.runAction(internal.greenScreenMeme.key, args, { retry: true });
      } else {
        if (planned.includes("copy")) {
          await step.runAction(internal.greenScreenMeme.writeMemeCaption, args, { retry: true });
        }
        await step.runAction(internal.greenScreenMeme.fetchMeme, args, { retry: true });
        if (planned.includes("style")) {
          await step.runAction(internal.greenScreenMeme.openStudio, args, { retry: true });
          await passGate(step, args.jobId, "style");
        }
        await step.runAction(internal.greenScreenMeme.render, args, { retry: true });
      }
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

async function passGate(step: WorkflowCtx, jobId: Id<"jobs">, stepId: string): Promise<void> {
  await step.awaitEvent({ name: `approve:${jobId}:${stepId}` });
  await step.runMutation(internal.jobs.patchStep, { jobId, stepId, state: "done" });
  await step.runMutation(internal.jobs.setRunning, { jobId });
}

// ---------------------------------------------------------------- resolving the inputs

interface ResolvedMeme {
  /** What the render composites. */
  url: string;
  /** What the studio shows. */
  previewUrl: string;
  isVideo: boolean;
  /** Width over height. */
  aspect: number;
  title: string;
  hasSound: boolean;
  source: "klipy" | "upload";
}

/** The meme as URLs: Klipy's as its API returned them, an upload from storage -- the client's own only. */
async function resolveMeme(ctx: ActionCtx, raw: unknown, clientId: Id<"clients">): Promise<ResolvedMeme> {
  const pick = parseMemePick(raw);
  if (!pick) throw new Error("Choose a meme first.");
  if (pick.source === "klipy") {
    return {
      url: pick.url,
      previewUrl: pick.previewUrl,
      isVideo: pick.isVideo,
      aspect: pick.width && pick.height ? pick.width / pick.height : 1,
      title: pick.title,
      hasSound: pick.hasSound,
      source: "klipy",
    };
  }
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId: pick.assetId as Id<"assets"> });
  if (!asset || asset.clientId !== clientId) throw new Error("The meme you uploaded could not be found.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("The meme you uploaded could not be read.");
  const isVideo = asset.kind === "video";
  return {
    url,
    previewUrl: url,
    isVideo,
    aspect: asset.width && asset.height ? asset.width / asset.height : 1,
    title: "",
    // Whether a clip really has sound is found out at the render.
    hasSound: isVideo,
    source: "upload",
  };
}

/** The background as a URL, and whether it moves. The client's own asset only. */
async function resolveBackground(
  ctx: ActionCtx,
  assetId: Id<"assets"> | undefined,
  clientId: Id<"clients">,
): Promise<{ url: string; isVideo: boolean }> {
  if (!assetId) throw new Error("Choose a background image or video first.");
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset || asset.clientId !== clientId) throw new Error("The background could not be found.");
  if (asset.kind !== "image" && asset.kind !== "video") throw new Error("The background has to be an image or a video.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("The background could not be read.");
  return { url, isVideo: asset.kind === "video" };
}

/**
 * P9. Checks the meme and the background resolve -- free -- so a missing
 * upload fails here rather than after the caption is edited.
 */
export const fetchMeme = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "meme", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;

    const meme = await resolveMeme(ctx, config.meme, clientId);
    const background = await resolveBackground(ctx, config.background, clientId);

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "meme",
      primitive: "P9",
      model: meme.source === "klipy" ? "klipy" : "my-memes",
      units: 1,
      unitLabel: "memes",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "meme",
      state: "done",
      output: { meme, background },
    });
    return null;
  },
});

// ---------------------------------------------------------------- the caption

const MEME_CAPTION_SYSTEM = `You write the caption for a meme video: a GIF or clip placed over the
poster's own photo or video, with one line of text above it -- the format
meme accounts and brands post on TikTok and Instagram Reels.

The caption is the setup; the meme is the punchline. It names a specific,
relatable situation and the meme is the reaction to it. Patterns that work:
- "POV: [a situation the audience knows too well]"
- "me when [specific moment]"
- "when [someone] says [something] and you [do something]"
- "[group] after [doing the thing]"

- 5 to 14 words. One line, no line breaks.
- Casual and a little self-aware, lowercase-leaning; CAPS on one word at most.
- No hashtags, no quotation marks, no markdown. At most one emoji.
- Play off what the meme shows -- you're told its title -- rather than
  describing it back.
- If told to mention a business, the caption names it: the poster switched
  that on so it would be. Make the situation the problem it solves -- the
  moment its customers know too well -- and let the name be the twist inside
  whichever pattern you pick, not a tag on the end. The profile comes with a rule
  on whether "me" has used it; follow it exactly. When they haven't, the
  business is a discovery, said as what it CAN do -- never as something that
  already happened to "me" ("me when X already did it", "X turned my pile
  into..."). Only what the profile says it does: no speed, savings or
  results it doesn't state. Never an advert; it has to still be a meme.
- Use the whole range of patterns above -- whichever fits this meme best,
  not "me finding..." by default.
- Asked to improve a caption: keep the situation it's getting at and make it
  land harder. Don't swap in a different joke.`;

const CAPTION_TOOL = {
  name: "save_caption",
  description: "Save the meme caption.",
  input_schema: {
    type: "object",
    properties: {
      caption: { type: "string", description: "5 to 14 words, one line." },
    },
    required: ["caption"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
/** A runaway guard: the box and the studio both hold one line. */
const MAX_CAPTION_CHARS = 200;

/** One caption from the writer: fresh, or a sharper take on one already typed. */
async function writeMemeLine(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  { current, memeTitle, mentionBusiness }: { current?: string; memeTitle?: string; mentionBusiness?: boolean },
): Promise<{ caption: string; tokens: number; costUsd: number }> {
  const about = memeTitle ? `The meme: ${memeTitle}.` : "The meme is a reaction GIF.";
  const ask =
    (current ? `${about}\nImprove this caption:\n${current}` : `${about}\nWrite the caption.`) +
    (await businessContext(ctx, clientId, mentionBusiness));
  const call = await callTool(MEME_CAPTION_SYSTEM, ask, CAPTION_TOOL as never);
  const caption = String((call.value as { caption?: string })?.caption ?? "")
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/^["“]+|["”]+$/g, "")
    .slice(0, MAX_CAPTION_CHARS);
  if (!caption) throw new Error("model returned no caption");
  return {
    caption,
    tokens: call.inputTokens + call.outputTokens,
    costUsd: (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M,
  };
}

/** A Klipy meme's title; an upload has none. */
function memeTitleOf(raw: unknown): string {
  const pick = parseMemePick(raw);
  return pick?.source === "klipy" ? pick.title : "";
}

/**
 * P1, planned while Add captions is on (on jobs from before the switch, while
 * the Hook caption box is blank). A typed caption is kept as it is, for free.
 * With nothing to write from
 * -- an uploaded meme has no title, and no business to mention -- the studio
 * opens with no caption rather than the run failing: the caption is typed
 * there instead.
 */
export const writeMemeCaption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;
    const done = (caption: string) =>
      ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "done", output: { caption } });

    const typed = (config.caption ?? "").trim().slice(0, MAX_CAPTION_CHARS);
    if (typed) {
      await done(typed);
      return null;
    }
    const memeTitle = memeTitleOf(config.meme);
    if (!memeTitle && !config.mentionBusiness) {
      await done("");
      return null;
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.02 });
    const { caption, tokens, costUsd } = await writeMemeLine(ctx, clientId, {
      memeTitle,
      mentionBusiness: config.mentionBusiness,
    });
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
    await done(caption);
    return null;
  },
});

/**
 * The Improvise button, under the Hook caption box and in the studio: the
 * caption as typed, made to land harder -- or, with nothing typed, a fresh
 * one from the meme and the business. Returned to the browser, which keeps
 * it or undoes it; nothing is saved here.
 */
export const improveCaption = action({
  args: {
    caption: v.optional(v.string()),
    memeTitle: v.optional(v.string()),
    mentionBusiness: v.optional(v.boolean()),
  },
  handler: async (ctx, { caption, memeTitle, mentionBusiness }): Promise<{ caption: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, { authUserId: identity.subject });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");

    const current = (caption ?? "").trim().slice(0, MAX_CAPTION_CHARS);
    const title = (memeTitle ?? "").trim().slice(0, 200);
    // The panel checks these before calling; these are the boundary.
    if (!current && !title && !mentionBusiness) {
      throw new Error("Type a caption, pick a meme, or switch on Mention your business so we can write one.");
    }
    if (mentionBusiness) {
      const brand = await ctx.runQuery(internal.brands.forClientInternal, { clientId: client._id });
      if (!brand?.description) throw new Error("Add your business details first — they're what it's written from.");
    }
    await enforceRateLimit(ctx, "rewriteText", client._id);
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId: client._id, aboutToSpendUsd: 0.02 });

    const written = await writeMemeLine(ctx, client._id, {
      current: current || undefined,
      memeTitle: title || undefined,
      mentionBusiness,
    });
    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      stepId: "improvise",
      primitive: "P1",
      model: LLM_MODEL,
      units: written.tokens,
      unitLabel: "tokens",
      costUsd: written.costUsd,
    });
    return { caption: written.caption };
  },
});

// ---------------------------------------------------------------- the meme studio

/** Whose sound plays by default: the meme's when it has any, else a background video's. */
function defaultSound(meme: ResolvedMeme, background: { isVideo: boolean }) {
  return meme.hasSound ? ("meme" as const) : background.isVideo ? ("background" as const) : ("meme" as const);
}

/**
 * Parks the run in the studio with a starting design: the caption written (or
 * typed) in the meme-account look, and the meme centred under it -- keyed
 * when it's an upload or says it's a green screen. For "Edit meme again", the
 * design the last render was made from. The URLs are for the preview; the
 * render resolves everything again, since an approved output is whatever the
 * browser sent back.
 */
export const openStudio = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "style", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;

    const meme = await resolveMeme(ctx, config.meme, clientId);
    const background = await resolveBackground(ctx, config.background, clientId);
    const written = (job.steps.find((s) => s.id === "copy")?.output as { caption?: string } | undefined)?.caption;
    const caption = config.captions === false ? "" : (written ?? config.caption ?? "").trim();
    const pick = parseMemePick(config.meme) as MemePick;

    const design = config.design
      ? sanitizeMemeDesign(config.design)
      : memeCaptionDesign(
          caption,
          defaultMemeLayer({ keyable: looksKeyable(pick), sound: defaultSound(meme, background) }),
        );

    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "style",
      output: {
        design,
        videoUrl: background.isVideo ? background.url : null,
        posterUrl: background.isVideo ? null : background.url,
        audioUrl: null,
        previewSeconds: null,
        meme: {
          url: meme.previewUrl,
          isVideo: meme.isVideo,
          aspect: meme.aspect,
          title: meme.title,
          hasSound: meme.hasSound,
          source: meme.source,
        },
      },
    });
    return null;
  },
});

/** The approved design, or -- for a run that somehow skipped the studio -- the starting one. */
function approvedDesign(job: Doc<"jobs">, meme: ResolvedMeme, background: { isVideo: boolean }) {
  const approved = (job.steps.find((s) => s.id === "style")?.output as { design?: unknown } | undefined)?.design;
  if (approved) return sanitizeMemeDesign(approved);
  const config = job.config as MemeConfig;
  if (config.design) return sanitizeMemeDesign(config.design);
  const caption = (job.steps.find((s) => s.id === "copy")?.output as { caption?: string } | undefined)?.caption ?? "";
  return memeCaptionDesign(
    caption.trim(),
    defaultMemeLayer({ keyable: looksKeyable(parseMemePick(config.meme)), sound: defaultSound(meme, background) }),
  );
}

/** P7 + P8 in one hop: the meme onto the background, the text layer over both. */
export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "render", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;

    // Checked again here for jobs that reached the studio before the gate.
    if (parseMemePick(config.meme)?.source === "klipy" && !klipyServerRenderApproved()) {
      throw new Error(KLIPY_RENDER_BLOCKED);
    }
    const meme = await resolveMeme(ctx, config.meme, clientId);
    const background = await resolveBackground(ctx, config.background, clientId);
    const design = approvedDesign(job, meme, background);
    // An empty main text draws nothing -- not even a Snapchat bar.
    const layer = design.text.trim() ? design : { ...design, background: "none" as const };

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${renderServiceBase()}/render/green-screen-meme`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        layerHtml: wallLayerHtml(layer, null),
        backgroundUrl: background.url,
        memeUrl: meme.url,
        meme: design.meme,
        sound: design.meme.sound,
        seconds: background.isVideo ? null : design.meme.seconds,
        maxDurationSec: MAX_SECONDS,
        uploadUrl,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      // An instance from before the studio reads this as the old request and asks for a clip.
      if (/a clip is required/.test(body)) {
        throw new Error(
          "The render service is running old code that can't place a meme. Restart it (cd ../render-service && npm start), then make the video again.",
        );
      }
      throw new Error(`render service failed: ${res.status} ${body}`);
    }
    const out = (await res.json()) as {
      width: number;
      height: number;
      storageId: Id<"_storage">;
      bytes: number;
      contentType: string;
      durationSec?: number;
    };

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
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      // The design travels with the render, so "Edit meme again" reopens it.
      output: { files: [{ name: "output.mp4" }], design },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

// ---------------------------------------------------------------- before the studio

/** P9. Resolves the config's chosen trending clip to a fetchable URL. Free. */
export const fetchClip = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;
    if (!config.trendingClip) throw new Error("No trending clip selected.");

    const clip = await ctx.runQuery(internal.greenScreenMeme.clipRow, {
      clipId: config.trendingClip,
    });
    if (!clip) throw new Error("The selected clip no longer exists.");
    const url = await ctx.storage.getUrl(clip.storageId);
    if (!url) throw new Error("The selected clip's video could not be read.");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P9",
      model: "clip-library",
      units: 1,
      unitLabel: "clips",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clip",
      state: "done",
      output: { url, durationSec: clip.durationSec, width: clip.width, height: clip.height },
    });
    return null;
  },
});

export const clipRow = internalQuery({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => ctx.db.get(clipId),
});

const CAPTION_SYSTEM = `You write a short on-screen caption (at most 100 characters) for a meme
video: a trending green-screen clip composited over a background image.

- One punchy line that plays off the joke or the format, not a description of it.
- No markdown, no emoji, no hashtags, no quotation marks.
- Specific beats generic: reference the actual scenario given, not a
  one-size-fits-all meme caption that could sit under any clip.
- If told to mention a business, weave its name in naturally -- don't append it.`;

const MAX_CHARS = 100;

/** P1, the old way: a caption from the job's prompt. */
export const writeCaption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as MemeConfig;

    const brief = (config.prompt ?? "").trim();
    if (!brief) throw new Error("Give a prompt to generate the caption from.");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.02 });

    const userPrompt = brief + (await businessContext(ctx, clientId, config.mentionBusiness));
    const call = await callTool(CAPTION_SYSTEM, userPrompt, CAPTION_TOOL as never);
    const caption = String((call.value as { caption?: string })?.caption ?? "").trim();
    if (!caption) throw new Error("model returned no caption");
    if (caption.length > MAX_CHARS) {
      throw new Error(`caption is ${caption.length} chars, over the ${MAX_CHARS} limit`);
    }

    const costUsd =
      (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M;
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { caption },
    });
    return null;
  },
});

/** P7 + P8, the old way: the trending clip keyed over a still, captioned in a fixed style. */
export const key = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "key", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();
    const config = job.config as MemeConfig;
    if (!config.background) throw new Error("A background image is required.");

    const clipUrl = (job.steps.find((s) => s.id === "clip")?.output as { url?: string } | undefined)
      ?.url;
    if (!clipUrl) throw new Error("The clip has not been fetched yet.");

    const bgAsset = await ctx.runQuery(internal.assets.getInternal, { assetId: config.background });
    if (!bgAsset) throw new Error("The background image could not be found.");
    const backgroundUrl = await ctx.storage.getUrl(bgAsset.storageId);
    if (!backgroundUrl) throw new Error("The background image could not be read.");

    const captionText =
      (job.steps.find((s) => s.id === "copy")?.output as { caption?: string } | undefined)
        ?.caption ?? "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/green-screen-meme`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        clipUrl,
        backgroundUrl,
        dimensions: config.aspectRatio ?? "9:16",
        captionText,
        captionStyle: config.captionStyle ?? "Classic",
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

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "key",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "key",
      state: "done",
      output: { files: [{ name: "output.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.greenScreenMeme.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});

/** Whether KLIPY memes can be rendered yet (lib/klipyTerms.ts) -- the meme popup says so when they can't. */
export const klipyRenderAllowed = query({
  args: {},
  handler: async (): Promise<boolean> => klipyServerRenderApproved(),
});
