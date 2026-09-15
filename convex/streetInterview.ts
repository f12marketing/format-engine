import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";

/**
 * Street Interview: script -> speech -> the product composited into an
 * unedited-iPhone-footage vox-pop scene -> animated -> spoken and captioned.
 *
 * Unlike Claymation (whose "scene" step composites just the product into a
 * generic backdrop) or On a Walk/Netflix Documentary (whose "scene" step
 * composites a specific roster avatar), this format has neither a roster
 * persona nor a bare-product backdrop: it needs a generic vox-pop subject
 * shown alongside the product, so `composeStreetScene` is its own primitive
 * rather than a reuse of either.
 *
 * "Dialogue" is optional (write-it-for-you like Claymation's "narration"),
 * so "copy" only runs when it's blank -- see `broadcastScenePipeline` in
 * `planned.ts`. Uses `scriptPrimitive` (first-person, direct-to-camera),
 * not `narrationPrimitive` (third-person voiceover): a vox-pop subject is
 * speaking to the interviewer/camera, not being narrated over.
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
        { ...args, textConfigField: "dialogue" },
        { retry: true },
      );
      await step.runAction(internal.streetInterview.composeStreetScene, args, { retry: true });
      await step.runAction(internal.lib.animateScenePrimitive.animateScene, args, { retry: true });
      await step.runAction(
        internal.lib.narratedClipPrimitive.renderNarratedClip,
        { ...args, textConfigField: "dialogue" },
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
  "Solo, mic only": "one interview subject speaking to camera, a handheld " +
    "microphone visible in frame, the interviewer stays off-camera",
  "Multiple, mic only": "two or three different interview subjects sharing " +
    "the frame in sequence, a handheld microphone visible, the interviewer " +
    "stays off-camera",
  "Solo, both in frame": "one interview subject and the interviewer both " +
    "visible in frame, interviewer holding the microphone out toward the subject",
  "Multiple, both in frame": "a small group of interview subjects and the " +
    "interviewer all visible in frame, interviewer holding the microphone " +
    "out toward whoever is speaking",
};

/** P2. Composites the product into a street vox-pop interview scene. */
export const composeStreetScene = internalAction({
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
      FRAMING_BY_STYLE[config.style ?? ""] ?? FRAMING_BY_STYLE["Solo, mic only"];
    const topic = (config.prompt ?? "").trim();
    const wrap = (action: string) =>
      `Candid unedited street vox-pop interview, shot like a handheld iPhone ` +
      `video, natural outdoor daylight, slight handheld wobble and casual ` +
      `framing, ${framing}. @image1 is the product being discussed -- ` +
      `${action}. ${topic ? `Context: ${topic}. ` : ""}${
        config.brandName ? `Brand: ${config.brandName}. ` : ""
      }High quality, no text, no UI elements.`;

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [imageUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("held up naturally by the subject mid-sentence"),
      () => wrap("visible in frame near the subject"),
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
    const id = await workflow.start(ctx, internal.streetInterview.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
