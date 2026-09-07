import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL } from "./lib/fal";

/**
 * Speaking Hook & Demo: an avatar says the hook out loud, then cuts to the
 * demo video -- audibly the same shape as Video Hook & Demo, just with a
 * generated speaker instead of a trending clip for the first segment, which
 * is why "stitch" reuses that exact render-service endpoint unchanged.
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
        await step.runAction(internal.speakingHookDemo.writeHook, args, { retry: true });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "saying" },
        { retry: true },
      );
      await step.runAction(internal.speakingHookDemo.animateAvatar, args, { retry: true });
      await step.runAction(internal.speakingHookDemo.stitch, args, { retry: true });
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

const HOOK_SYSTEM = `You write a single spoken line for a UGC-style video hook -- the first thing
someone says directly to camera before a product demo plays.

- One or two short sentences, written to be SPOKEN aloud, not read.
- A bold claim, a relatable callout, or a sharp question -- never a title.
- No markdown, no emoji, no hashtags, no stage directions.
- Match the requested delivery style in wording, not just tone -- "Shocked"
  reads differently on the page than "Deadpan" even before anyone says it.
- If told to mention a business, weave its name in naturally -- don't append it.`;

const HOOK_TOOL = {
  name: "save_hook",
  description: "Save the generated spoken hook line.",
  input_schema: {
    type: "object",
    properties: { saying: { type: "string" } },
    required: ["saying"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

export const writeHook = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as {
      hook?: string;
      delivery?: string;
      mentionBusiness?: boolean;
    };
    const hook = (config.hook ?? "").trim();
    if (!hook) throw new Error("A hook is required.");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.03 });

    const userPrompt =
      `Hook topic: ${hook}\nDelivery style: ${config.delivery ?? "Auto"}` +
      (config.mentionBusiness ? "\n\nMention the business by name." : "");
    const call = await callTool(HOOK_SYSTEM, userPrompt, HOOK_TOOL as never);
    const saying = String((call.value as { saying?: string })?.saying ?? "").trim();
    if (!saying) throw new Error("model returned no line");

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
      output: { text: saying },
    });
    return null;
  },
});

export const animateAvatar = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { speaker?: Id<"avatars">; delivery?: string };
    if (!config.speaker) throw new Error("No speaker selected.");

    const deliveryPrompt =
      config.delivery && config.delivery !== "Auto"
        ? `Deliver this with a ${config.delivery.toLowerCase()} reaction/tone.`
        : undefined;

    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      avatarId: config.speaker,
      prompt: deliveryPrompt,
    });
  },
});

/** P7 + P8 in one hop, reusing Video Hook & Demo's exact renderer: two segments, caption on the first. */
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
    if (!base) throw new Error("RENDER_SERVICE_URL is not set on the deployment.");

    const config = job.config as { demoVideo?: Id<"assets">; captionStyle?: string };
    if (!config.demoVideo) throw new Error("A demo video upload is required.");

    const hookUrl = (job.steps.find((s) => s.id === "avatar")?.output as
      | { videoUrl?: string }
      | undefined)?.videoUrl;
    if (!hookUrl) throw new Error("The speaker has not been rendered yet.");

    const demoAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.demoVideo,
    });
    if (!demoAsset) throw new Error("The demo video upload could not be found.");
    const demoUrl = await ctx.storage.getUrl(demoAsset.storageId);
    if (!demoUrl) throw new Error("The demo video upload could not be read.");

    const captionText =
      (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)?.text ??
      "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/video-hook-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hookUrl,
        demoUrl,
        dimensions: "9:16",
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
    const id = await workflow.start(ctx, internal.speakingHookDemo.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
