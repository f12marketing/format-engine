import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";
import { resolveRosterPersona } from "./lib/roster";

/**
 * On a Walk: narration -> speech -> a walking-selfie scene composited around
 * the roster avatar -> animated -> narrated and captioned.
 *
 * Same five-stage shape as Cutting Fruit -- narration and speech over a
 * generated scene, not a talking avatar, so there's no P5 lipsync step here
 * either. Only the "scene" step differs between the two; every other stage
 * is the identical shared primitive, unchanged.
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
        // On a Walk's copy step is unconditional (no `when`), so this
        // fallback field is never actually read -- required by the shared
        // primitive's signature regardless. Same as Cutting Fruit.
        { ...args, textConfigField: "prompt", speakerConfigField: "whosWalking" },
        { retry: true },
      );
      await step.runAction(internal.onAWalk.composeWalkingScene, args, { retry: true });
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

const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K

/** P2. Composites the roster avatar into a walking, arm's-length selfie shot. */
export const composeWalkingScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { whosWalking?: string; prompt?: string; style?: string };
    if (!config.whosWalking) throw new Error("Choose who's walking.");

    const { imageUrl: avatarUrl, description } = await resolveRosterPersona(ctx, config.whosWalking, { clientId, jobId });

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const topic = (config.prompt ?? "").trim();
    // A selfie framing puts the face front and center, so identity fidelity
    // to @image1 matters more here than in a wider shot -- called out
    // explicitly rather than assumed.
    const wrap = (action: string) =>
      `@image1 is a person (${description}). Vertical selfie-style photo shot at arm's length, ` +
      `walking outdoors on a sidewalk or street, casual candid content-creator angle, natural ` +
      `daylight lighting the person's face and skin tone consistently with the outdoor scene, ` +
      `slight motion blur in the background suggesting movement, ${action}. ` +
      `${topic ? `Context: ${topic}. ` : ""}${config.style ? `Tone: ${config.style}. ` : ""}` +
      "Keep the person's face and features consistent with @image1. High quality, no text, no watermark, no UI elements.";

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [avatarUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("looking toward the camera mid-stride"),
      () => wrap("walking with a relaxed, neutral expression"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no scene image returned");

    // Persisted rather than kept as fal's own URL -- same reasoning as every
    // other composite step in this codebase.
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
    const id = await workflow.start(ctx, internal.onAWalk.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
