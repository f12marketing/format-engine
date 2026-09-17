import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL } from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

/**
 * Green Screen Meme: a trending green-screen clip, chroma-keyed over the
 * user's own background image, with a caption on top.
 *
 * Same P9 shape as Video Hook & Demo -- a free library read against a clip
 * ingested ahead of time, never a live ScrapeCreators call from inside a run.
 */
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
        await step.runAction(internal.greenScreenMeme.fetchClip, args, { retry: true });
      }
      if (planned.includes("copy")) {
        await step.runAction(internal.greenScreenMeme.writeCaption, args, { retry: true });
      }
      await step.runAction(internal.greenScreenMeme.key, args, { retry: true });
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

/** P9. Resolves the config's chosen clip to a fetchable URL. Free. */
export const fetchClip = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { trendingClip?: Id<"clips"> };
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

const CAPTION_TOOL = {
  name: "save_caption",
  description: "Save the generated caption.",
  input_schema: {
    type: "object",
    properties: {
      caption: { type: "string", description: "At most 100 characters." },
    },
    required: ["caption"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
const MAX_CHARS = 100;

/** P1. Skippable via `when` upstream; runs whenever "copy" is in the plan. */
export const writeCaption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { prompt?: string; mentionBusiness?: boolean };

    const brief = (config.prompt ?? "").trim();
    if (!brief) throw new Error("Give a prompt to generate the caption from.");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.02 });

    const userPrompt = config.mentionBusiness
      ? `${brief}\n\nMention the business by name.`
      : brief;
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

/** P7 + P8 in one hop -- same reasoning as Custom and Video Animation's merged stitch. */
export const key = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "key", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as {
      background?: Id<"assets">;
      aspectRatio?: string;
      captionStyle?: string;
    };
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
