import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";

/**
 * AI News Anchor: script -> speech -> the product composited into a news
 * studio scene with an anchor -> animated -> spoken and captioned.
 *
 * Same shape as Street Interview -- see that file's header for why this
 * needs its own "scene" primitive rather than reusing `clayScenePrimitive`
 * or `resolveRosterPersona`. "News item" is optional (write-it-for-you like
 * Claymation's "narration"), so "copy" only runs when it's blank -- see
 * `broadcastScenePipeline` in `planned.ts`. Uses `scriptPrimitive`
 * (first-person, direct-to-camera), since an anchor delivers to camera
 * rather than being narrated over.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.lib.scriptPrimitive.writeScript, args, { retry: true });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "newsItem" },
        { retry: true },
      );
      await step.runAction(internal.aiNewsAnchor.composeNewsroomScene, args, { retry: true });
      await step.runAction(internal.lib.animateScenePrimitive.animateScene, args, { retry: true });
      await step.runAction(
        internal.lib.narratedClipPrimitive.renderNarratedClip,
        { ...args, textConfigField: "newsItem" },
        { retry: true },
      );
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

const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K

const FRAMING_BY_STYLE: Record<string, string> = {
  "News desk close": "a tight news-desk close-up on the anchor, shallow depth " +
    "of field, a softly blurred studio backdrop with a network-style lower-third bar",
  "News desk wide": "a wide news-desk shot showing the anchor behind the desk " +
    "with the full studio set and a screen graphic behind them",
  "Late bulletin, dark studio": "a late-night bulletin look, dim moody studio " +
    "lighting, the anchor lit mostly by the desk monitor's glow",
};

/** P2. Composites the product into a news-studio anchor scene. */
export const composeNewsroomScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as {
      productImage?: Id<"assets">;
      brandName?: string;
      prompt?: string;
      style?: string;
    };
    if (!config.productImage) throw new Error("A product image is required.");

    const asset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.productImage,
    });
    if (!asset) throw new Error("The product image could not be found.");
    const imageUrl = await ctx.storage.getUrl(asset.storageId);
    if (!imageUrl) throw new Error("Could not read the product image.");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const framing =
      FRAMING_BY_STYLE[config.style ?? ""] ?? FRAMING_BY_STYLE["News desk close"];
    const topic = (config.prompt ?? "").trim();
    const wrap = (action: string) =>
      `Professional TV news broadcast studio, an anchor at the news desk mid-` +
      `report, ${framing}. @image1 is the product being reported on -- ` +
      `${action}. ${topic ? `Story: ${topic}. ` : ""}${
        config.brandName ? `Brand: ${config.brandName}. ` : ""
      }High quality broadcast look, no text, no UI elements.`;

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [imageUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("shown as an on-screen graphic beside the anchor"),
      () => wrap("shown as a small prop on the news desk"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no scene image returned");

    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch scene image: ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
    const storedUrl = await ctx.storage.getUrl(storageId);
    if (!storedUrl) throw new Error("could not read back the stored scene image");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scene",
      primitive: "P2",
      model: "alibaba/qwen-image-3/edit",
      units: 1,
      unitLabel: "images",
      costUsd: COMPOSITE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scene",
      state: "done",
      output: { imageUrl: storedUrl },
    });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.aiNewsAnchor.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
