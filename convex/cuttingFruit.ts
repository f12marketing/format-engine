import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";

/**
 * Cutting Fruit: narration -> speech -> a kitchen scene composited around the
 * roster avatar -> animated -> narrated and captioned.
 *
 * Same five-stage shape as Claymation/Skeleton, but the "scene" step composites
 * an AVATAR reference rather than a plain product image -- different enough a
 * resolution path (roster lookup vs. a bare asset id) that it gets its own
 * action here instead of `clayScenePrimitive`, the same call as
 * Product Spokesperson/Green Screen Mobile's own "composite" steps.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.lib.narrationPrimitive.writeNarration, args, { retry: true });
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        // Cutting Fruit's copy step is unconditional (no `when`), so this
        // fallback field is never actually read -- required by the shared
        // primitive's signature regardless.
        { ...args, textConfigField: "prompt" },
        { retry: true },
      );
      await step.runAction(internal.cuttingFruit.composeKitchenScene, args, { retry: true });
      await step.runAction(internal.lib.animateScenePrimitive.animateScene, args, { retry: true });
      await step.runAction(internal.lib.narratedClipPrimitive.renderNarratedClip, args, {
        retry: true,
      });
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

const COMPOSITE_PRICE_PER_UNIT = 0.045; // fal-ai/flux-2-pro/edit

/** P2. Composites the roster avatar into a kitchen, mid-cut. */
export const composeKitchenScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { whosCutting?: Id<"avatars">; prompt?: string; style?: string };
    if (!config.whosCutting) throw new Error("Choose who's cutting.");

    const avatar = await ctx.runQuery(internal.avatars.getInternal, {
      avatarId: config.whosCutting,
    });
    if (!avatar) throw new Error("The selected avatar no longer exists.");
    const avatarAssetId = avatar.referenceAssetIds[0];
    if (!avatarAssetId) throw new Error("The selected avatar has no reference image.");

    const avatarAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: avatarAssetId,
    });
    if (!avatarAsset) throw new Error("The avatar's reference image could not be found.");
    const avatarUrl = await ctx.storage.getUrl(avatarAsset.storageId);
    if (!avatarUrl) throw new Error("Could not read the avatar's reference image.");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const topic = (config.prompt ?? "").trim();
    const wrap = (action: string) =>
      `@image1 is a person (${avatar.lookNotes || avatar.name}). Photorealistic kitchen counter ` +
      `scene, overhead or three-quarter angle on their hands, ${action}, cutting board, a sharp ` +
      `kitchen knife, natural light. ${topic ? `Context: ${topic}. ` : ""}` +
      `${config.style ? `Tone: ${config.style}. ` : ""}High quality, no text, no UI elements.`;

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [avatarUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "fal-ai/flux-2-pro/edit",
      buildInput,
      wrap("mid-motion cutting a piece of fruit"),
      () => wrap("holding a knife over a cutting board with fruit"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no scene image returned");

    // Persisted rather than kept as fal's own URL -- same reasoning as every
    // other composite step here.
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
      model: "fal-ai/flux-2-pro/edit",
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
    const id = await workflow.start(ctx, internal.cuttingFruit.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
