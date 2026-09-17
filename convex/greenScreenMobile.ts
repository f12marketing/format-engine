import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { submitWithContentPolicyFallback } from "./lib/fal";
import { resolveRosterPersona } from "./lib/roster";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

/**
 * Green Screen Mobile with App: a presenter holding a phone with the app on
 * screen. Same composite-then-animate shape as Product Spokesperson, minus
 * the gate -- the spec doesn't ask for one here, and there's less riding on
 * getting a phone-in-hand shot right than a product held up to camera.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.greenScreenMobile.composite, args, { retry: true });

      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.lib.scriptPrimitive.writeScript, args, { retry: true });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "script" },
        { retry: true },
      );
      await step.runAction(internal.greenScreenMobile.animateAvatar, args, { retry: true });
      await step.runAction(internal.greenScreenMobile.caption, args, { retry: true });
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

/** P2. Composites the roster presenter holding a phone showing the app screenshot. */
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
    const config = job.config as { presenter?: string; appScreenshot?: Id<"assets"> };
    if (!config.presenter) throw new Error("No presenter selected.");
    if (!config.appScreenshot) throw new Error("An app screenshot is required.");

    const [{ imageUrl: avatarUrl, description }, screenshotAsset] = await Promise.all([
      resolveRosterPersona(ctx, config.presenter),
      ctx.runQuery(internal.assets.getInternal, { assetId: config.appScreenshot }),
    ]);
    if (!screenshotAsset) throw new Error("The app screenshot could not be found.");
    const screenshotUrl = await ctx.storage.getUrl(screenshotAsset.storageId);
    if (!screenshotUrl) throw new Error("Could not read the app screenshot.");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const wrap = (action: string) =>
      `@image1 is the presenter (${description}). @image2 is an app screenshot. ` +
      `Composite a single photorealistic image of the presenter ${action}, holding a smartphone ` +
      "with anatomically correct hands at chest height angled toward the camera, @image2 shown " +
      "accurately, undistorted and fully readable on the phone's screen, consistent lighting and " +
      "shadows, plain neutral background. No extra text overlays beyond the screenshot itself, no watermark.";

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [avatarUrl, screenshotUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("presenting the app with an engaged, friendly expression"),
      () => wrap("standing"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no composite image returned");

    // Persisted rather than kept as fal's own URL: remix's "regenerate copy
    // only" can freeze and re-read this step's output far later than a fal
    // result URL is guaranteed to stay fetchable.
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
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "done",
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
    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      prompt: config.prompt,
    });
  },
});

/** P8. Custom's own renderer, pointed at the avatar clip. */
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

    const config = job.config as { script?: string };
    const avatarOut = job.steps.find((s) => s.id === "avatar")?.output as
      | { videoUrl?: string; durationSec?: number }
      | undefined;
    if (!avatarOut?.videoUrl) throw new Error("The presenter has not been rendered yet.");

    const written = (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)
      ?.text;
    const text = (written ?? config.script ?? "").trim();

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
        captionStyle: "Classic",
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
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.greenScreenMobile.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
