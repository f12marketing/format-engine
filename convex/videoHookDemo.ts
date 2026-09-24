import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL } from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { businessContext } from "./lib/businessContext";

/**
 * Video Hook & Demo: a trending clip as the hook, then the user's own demo
 * video, stitched together with a caption burned onto the hook segment.
 *
 * P9 (the clip) is a free library read, not a live fetch -- ingestion into
 * the shared `clips` table is a separate, standalone step (see
 * `lib/clipIngest.ts`), so a format run never waits on ScrapeCreators.
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
        await step.runAction(internal.videoHookDemo.fetchClip, args, { retry: true });
      }
      if (planned.includes("copy")) {
        await step.runAction(internal.videoHookDemo.writeCaption, args, { retry: true });
      }
      await step.runAction(internal.videoHookDemo.stitch, args, { retry: true });
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

    const clip = await ctx.runQuery(internal.videoHookDemo.clipRow, {
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

const CAPTION_SYSTEM = `You write a short on-screen caption (at most 100 characters) that hooks a
viewer into a trending clip before it cuts to a product demo.

- One punchy line. A question, a bold claim, or a relatable callout.
- No markdown, no emoji, no hashtags, no quotation marks.
- Skip generic hook openers like "wait for it" or "you won't believe" --
  spend the character budget on the actual claim, not the setup for one.
- If told to mention a business, weave its name in naturally -- don't append it.`;

const CAPTION_TOOL = {
  name: "save_caption",
  description: "Save the generated hook caption.",
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

/** P1. Skippable: a typed prompt with nothing to expand still needs this to fail loudly, not silently render blank. */
export const writeCaption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { prompt?: string; mentionBusiness?: boolean };

    const brief = (config.prompt ?? "").trim();
    if (!brief) throw new Error("Give a prompt to generate the hook caption from.");

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

/** P7 + P8 in one hop -- same reasoning as Custom and Video Animation's merged stitch. */
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as {
      demoVideo?: Id<"assets">;
      aspectRatio?: string;
      captionStyle?: string;
    };
    if (!config.demoVideo) throw new Error("A demo video upload is required.");

    const hookUrl = (job.steps.find((s) => s.id === "clip")?.output as { url?: string } | undefined)
      ?.url;
    if (!hookUrl) throw new Error("The hook clip has not been fetched yet.");

    const demoAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.demoVideo,
    });
    if (!demoAsset) throw new Error("The demo video upload could not be found.");
    const demoUrl = await ctx.storage.getUrl(demoAsset.storageId);
    if (!demoUrl) throw new Error("The demo video upload could not be read.");

    const captionText =
      (job.steps.find((s) => s.id === "copy")?.output as { caption?: string } | undefined)
        ?.caption ?? "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/video-hook-demo`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        hookUrl,
        demoUrl,
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
      stepId: "stitch",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "stitch",
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
    const id = await workflow.start(ctx, internal.videoHookDemo.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
