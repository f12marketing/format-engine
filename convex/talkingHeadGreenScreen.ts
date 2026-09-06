import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";

/**
 * Talking Head Green Screen: an avatar keyed into the corner of a demo video.
 * The one place in this format's own code that differs from Talking Head
 * UGC is the avatar-render prompt (asks for a keyable background) and the
 * final composite, which needs a real new renderer -- see
 * render-service/video.mjs's renderPictureInPicture and its own caveat about
 * a prompted-for green screen being weaker than an actual one.
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
      if (planned.includes("copy")) {
        await step.runAction(internal.lib.scriptPrimitive.writeScript, args, { retry: true });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "script" },
        { retry: true },
      );
      await step.runAction(internal.talkingHeadGreenScreen.animateAvatar, args, { retry: true });
      await step.runAction(internal.talkingHeadGreenScreen.compositePip, args, { retry: true });
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

const GREEN_SCREEN_PROMPT =
  "Rendered against a solid, evenly lit bright green chroma-key background -- " +
  "no other objects, texture, gradient or scenery behind the subject.";

export const animateAvatar = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { avatar?: Id<"avatars">; prompt?: string };
    if (!config.avatar) throw new Error("No avatar selected.");

    const prompt = config.prompt?.trim()
      ? `${config.prompt.trim()} ${GREEN_SCREEN_PROMPT}`
      : GREEN_SCREEN_PROMPT;

    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      avatarId: config.avatar,
      prompt,
    });
  },
});

/** P7 + P8 in one hop: key, place picture-in-picture and burn in captions. */
export const compositePip = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "pip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
    if (!base) throw new Error("RENDER_SERVICE_URL is not set on the deployment.");

    const config = job.config as { demoVideo?: Id<"assets">; script?: string };
    if (!config.demoVideo) throw new Error("A demo video upload is required.");

    const avatarUrl = (job.steps.find((s) => s.id === "avatar")?.output as
      | { videoUrl?: string }
      | undefined)?.videoUrl;
    if (!avatarUrl) throw new Error("The avatar has not been rendered yet.");

    const demoAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.demoVideo,
    });
    if (!demoAsset) throw new Error("The demo video upload could not be found.");
    const demoUrl = await ctx.storage.getUrl(demoAsset.storageId);
    if (!demoUrl) throw new Error("The demo video upload could not be read.");

    const captionText =
      (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)?.text ??
      config.script ??
      "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/picture-in-picture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demoUrl,
        avatarUrl,
        dimensions: "9:16",
        captionText,
        captionStyle: "Classic",
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
      stepId: "pip",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "pip",
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
    const id = await workflow.start(ctx, internal.talkingHeadGreenScreen.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
