import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";
import { resolveRosterPersona } from "./lib/roster";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

/**
 * Product Spokesperson: the avatar holds the product and talks about it.
 * Gated on the composite still (the one thing worth reviewing before paying
 * for a P5 render on top of it) -- the same `awaitEvent`/`setAwaitingApproval`
 * mechanism Video Animation proved first.
 *
 * The composite is persisted to Convex storage rather than kept as fal's own
 * URL, unlike Video Animation's ungated per-shot composites: a gate can sit
 * open for as long as a person takes to review it, and fal's URLs are not
 * guaranteed to outlive that wait.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const { jobId } = args;
    try {
      await step.runAction(internal.productSpokesperson.composite, args, { retry: true });
      await step.awaitEvent({ name: `approve:${jobId}:composite` });
      await step.runMutation(internal.jobs.patchStep, { jobId, stepId: "composite", state: "done" });
      await step.runMutation(internal.jobs.setRunning, { jobId });

      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.lib.scriptPrimitive.writeScript, args, { retry: true });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "script", speakerConfigField: "avatar" },
        { retry: true },
      );
      await step.runAction(internal.productSpokesperson.animateAvatar, args, { retry: true });
      await step.runAction(internal.productSpokesperson.caption, args, { retry: true });
      await step.runMutation(internal.jobs.finish, { jobId, status: "done" });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K

/** P2, gated. Composites the roster avatar holding the uploaded product image. */
export const composite = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { avatar?: string; productImage?: Id<"assets"> };
    if (!config.avatar) throw new Error("No avatar selected.");
    if (!config.productImage) throw new Error("A product image is required.");

    const [{ imageUrl: avatarUrl, description }, productAsset] = await Promise.all([
      resolveRosterPersona(ctx, config.avatar, { clientId, jobId }),
      ctx.runQuery(internal.assets.getInternal, { assetId: config.productImage }),
    ]);
    if (!productAsset) throw new Error("The product image could not be found.");
    const productUrl = await ctx.storage.getUrl(productAsset.storageId);
    if (!productUrl) throw new Error("Could not read the product image.");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    // The only composite in this codebase with no negative-instruction list at
    // all -- every sibling composite names "no text, no UI elements" or
    // similar, so a stray watermark or UI-style overlay was always as likely
    // here as anywhere else, just never told not to happen.
    const wrap = (action: string) =>
      `@image1 is the spokesperson (${description}). @image2 is the product. ` +
      `Composite a single photorealistic image of the spokesperson ${action}, holding the product ` +
      "naturally at chest height with anatomically correct hands, facing the camera, product " +
      "label clearly visible and undistorted, consistent lighting and shadows between subject " +
      "and product, plain neutral background. No text, no watermark, no UI elements.";

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [avatarUrl, productUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("presenting the product with an engaged, friendly expression"),
      () => wrap("standing"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no composite image returned");

    // Persisted, not kept as fal's own URL -- this step is gated, and the
    // gate can sit open far longer than a fal result URL is guaranteed to
    // stay fetchable.
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch composite image: ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
    const storedUrl = await ctx.storage.getUrl(storageId);
    if (!storedUrl) throw new Error("could not read back the stored composite");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "composite",
      primitive: "P2",
      model: "alibaba/qwen-image-3/edit",
      units: 1,
      unitLabel: "images",
      costUsd: COMPOSITE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "composite",
      output: { imageUrl: storedUrl },
    });
    return null;
  },
});

export const animateAvatar = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { prompt?: string };
    // No avatarId passed -- renderAvatarClip reads the composite step's
    // imageUrl first and only falls back to a roster lookup when there
    // isn't one, which is exactly the case here.
    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      prompt: config.prompt,
    });
  },
});

/**
 * P8. Custom's own renderer, pointed at the avatar clip. Still runs, with no
 * text, when Caption overlay is off -- same reasoning as Talking Head UGC's.
 */
export const caption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "captions",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as { script?: string; captionStyle?: string };
    const avatarOut = job.steps.find((s) => s.id === "avatar")?.output as
      | { videoUrl?: string; durationSec?: number }
      | undefined;
    if (!avatarOut?.videoUrl) throw new Error("The spokesperson has not been rendered yet.");

    const written = (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)
      ?.text;
    const captioned = job.steps.some((s) => s.id === "captions");
    const text = captioned ? (written ?? config.script ?? "").trim() : "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/custom`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        sourceUrl: avatarOut.videoUrl,
        sourceIsVideo: true,
        dimensions: "9:16",
        fit: "cover",
        text,
        captionStyle: config.captionStyle ?? "Classic",
        captionPosition: "bottom",
        durationSec: avatarOut.durationSec ?? 15,
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

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.productSpokesperson.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
