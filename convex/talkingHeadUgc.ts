import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

/**
 * Talking Head UGC: an avatar speaks a script to camera. The simplest of the
 * five avatar formats -- no compositing, no stitching onto other footage --
 * which is why it goes first: P1/P4/P5 are all shared primitives, and
 * "captions" is Custom's own renderer pointed at the avatar clip instead of
 * an upload. Nothing new to build at the render-service layer at all.
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
      await step.runAction(internal.talkingHeadUgc.animateAvatar, args, { retry: true });
      await step.runAction(internal.talkingHeadUgc.caption, args, { retry: true });
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

/** Thin wrapper: reads which avatar and prompt this format uses, then hands off to the shared P5 primitive. */
export const animateAvatar = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { avatar?: string; prompt?: string };
    if (!config.avatar) throw new Error("No avatar selected.");

    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      rosterRef: config.avatar,
      prompt: config.prompt,
    });
  },
});

/**
 * P8. Custom's own renderer, pointed at the avatar clip instead of an upload.
 *
 * Runs even when Caption overlay is off and the job has no "captions" step:
 * the avatar clip is still a fal URL at that point, and this is what frames
 * it to 9:16 and stores it as the job's output. It just burns no text.
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
    if (!avatarOut?.videoUrl) throw new Error("The avatar has not been rendered yet.");

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
    const id = await workflow.start(ctx, internal.talkingHeadUgc.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
