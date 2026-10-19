import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { requireClientForAction } from "./clients";
import { callTool, LLM_MODEL } from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { businessContext } from "./lib/businessContext";
import { isVideoRef, resolveVideo } from "./lib/videoRef";
import { enforceRateLimit } from "./lib/rateLimit";
import { languageName } from "./lib/voiceLanguages";
import { hasText, hookCaptionDesign, sanitizeDesign } from "./lib/wallOfTextDesign";
import { captionHook } from "./lib/hookCaption";

/**
 * Speaking Hook & Demo: an avatar says the hook out loud, then cuts to the
 * demo video -- audibly the same shape as Video Hook & Demo, just with a
 * generated speaker instead of a trending clip for the first segment, which
 * is why "stitch" reuses that exact render-service endpoint unchanged.
 *
 * The Speaker field is the hook popup: a person to say a new line, or
 * "video:<assetId>" -- a hook from My hooks or one of the client's videos,
 * reused as it is. Every speaker clip this renders is kept there, with its
 * line, for exactly that.
 *
 * The caption is Video Hook & Demo's: the Captions box (or, left blank, what
 * they say), edited and styled in Wall of Text's studio once the speaker
 * exists, then burned onto the speaker clip before the demo is joined on.
 * With Add captions off there's no studio and no caption at all.
 * Jobs from before the studio have no "style" step and keep the old
 * Subtitle style burn-in.
 */
interface SpeakingConfig {
  speaker?: string;
  saying?: string;
  delivery?: string;
  language?: string;
  mentionBusiness?: boolean;
  demoVideo?: Id<"assets">;
  /** The "Add captions" switch. Off skips the studio; older jobs have none and are captioned. */
  captions?: boolean;
  /** The Captions box: the on-screen line, word for word. Blank is what they say. */
  caption?: string;
  /** Before the studio, how the subtitles looked. Still read for older jobs. */
  captionStyle?: string;
  /** Set by "Add captions" / "Edit captions again": a finished job's design, reopened in the studio. */
  design?: unknown;
}

/** A spoken hook plays in full; this caps what one caption pass may encode. */
const MAX_HOOK_SECONDS = 60;

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
      if (planned.includes("speech")) {
        await step.runAction(
          internal.lib.speechPrimitive.generateSpeech,
          { ...args, textConfigField: "saying", deliveryConfigField: "delivery", speakerConfigField: "speaker" },
          { retry: true },
        );
      }
      if (planned.includes("avatar")) {
        await step.runAction(internal.speakingHookDemo.animateAvatar, args, { retry: true });
        await step.runAction(internal.speakingHookDemo.keepHook, args);
      }
      if (planned.includes("style")) {
        await step.runAction(internal.speakingHookDemo.openStudio, args, { retry: true });
        await passGate(step, args.jobId, "style");
      }
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

async function passGate(step: WorkflowCtx, jobId: Id<"jobs">, stepId: string): Promise<void> {
  await step.awaitEvent({ name: `approve:${jobId}:${stepId}` });
  await step.runMutation(internal.jobs.patchStep, { jobId, stepId, state: "done" });
  await step.runMutation(internal.jobs.setRunning, { jobId });
}

const HOOK_SYSTEM = `You write a single spoken line for a UGC-style video hook -- the first thing
someone says directly to camera before a product demo plays.

- 10 to 12 words: one or two short sentences, written to be SPOKEN aloud,
  not read. It may also be the on-screen caption, so every word has to earn it.
- A bold claim, a relatable callout, or a sharp question -- never a title.
- No markdown, no emoji, no hashtags, no stage directions.
- Match the requested delivery style in wording, not just tone -- "Shocked"
  reads differently on the page than "Deadpan" even before anyone says it.
- Skip generic hook openers like "wait for it", "you need to see this", or
  "stop scrolling" -- they've been said in a million other hooks and read as
  filler rather than the actual claim.
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
    const config = job.config as SpeakingConfig;

    // A hook from My hooks already says something; its line is the caption.
    if (config.speaker && isVideoRef(config.speaker)) {
      const { hookLine } = await resolveVideo(ctx, config.speaker, clientId);
      await ctx.runMutation(internal.jobs.patchStep, {
        jobId,
        stepId: "copy",
        state: "done",
        output: { text: hookLine ?? "" },
      });
      return null;
    }

    // No topic box any more: the business is the brief. Checked here, the
    // first step, so a run with nothing to say fails before any voice or
    // video is paid for.
    if (!config.mentionBusiness) {
      throw new Error("Type what they say, or switch on Mention your business so we can write it.");
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.03 });

    const userPrompt =
      `Write the hook for a demo of this business's product.\nDelivery style: ${config.delivery ?? "Auto"}` +
      `\nLanguage: write it in ${languageName(config.language)}, as a native speaker would say it.` +
      (await businessContext(ctx, clientId, true));
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

/**
 * The panel's "Mention your business" switch: writes What they say in the
 * business's own voice -- a rewrite of what's typed, or a fresh line when
 * nothing is -- in the chosen language and delivery. Returned to the browser
 * rather than saved anywhere; the client keeps it or undoes it.
 *
 * No profile yet is an answer, not an error: the switch sits right above the
 * business card that fills one in, so the panel says so there rather than
 * surfacing a thrown error for the most ordinary state a new client is in.
 */
export const personalizeLine = action({
  args: {
    saying: v.optional(v.string()),
    delivery: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { saying, delivery, language },
  ): Promise<{ saying: string; business: string } | { needsBusiness: true }> => {
    const client = await requireClientForAction(ctx);

    const brand = await ctx.runQuery(internal.brands.forClientInternal, { clientId: client._id });
    if (!brand?.description) return { needsBusiness: true };
    await enforceRateLimit(ctx, "rewriteText", client._id);
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId: client._id, aboutToSpendUsd: 0.02 });

    const typed = (saying ?? "").trim().slice(0, 300);
    const userPrompt =
      (typed
        ? `Rewrite this line in the business's own style and voice, keeping what it's getting at:\n${typed}`
        : "Write the hook for a demo of this business's product.") +
      `\nDelivery style: ${delivery ?? "Auto"}` +
      `\nLanguage: write it in ${languageName(language)}, as a native speaker would say it.` +
      (await businessContext(
        ctx,
        client._id,
        true,
        "Write it the way this business talks to its customers -- its tone, its words -- and name it naturally, never as an ad read.",
      ));
    const call = await callTool(HOOK_SYSTEM, userPrompt, HOOK_TOOL as never);
    const line = String((call.value as { saying?: string })?.saying ?? "").trim().slice(0, 120);
    if (!line) throw new Error("Couldn't write that line — try again.");

    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      stepId: "personalize",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M,
    });
    return { saying: line, business: brand.name };
  },
});

export const animateAvatar = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SpeakingConfig;
    if (!config.speaker) throw new Error("No speaker selected.");

    const deliveryPrompt =
      config.delivery && config.delivery !== "Auto"
        ? `Deliver this with a ${config.delivery.toLowerCase()} reaction/tone.`
        : undefined;

    return ctx.runAction(internal.lib.avatarPrimitive.renderAvatarClip, {
      jobId,
      clientId,
      rosterRef: config.speaker,
      prompt: deliveryPrompt,
    });
  },
});

/**
 * Keeps the speaker clip in My hooks, with the line it says. The renderer's
 * URL is temporary, so the bytes are copied into storage.
 *
 * Not a declared step and not retried: a hook that fails to be kept costs
 * the client a reuse later, not this video -- so it logs and moves on
 * rather than failing a run whose deliverable is still fine.
 */
export const keepHook = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    try {
      const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
      if (!job) return null;
      const avatar = job.steps.find((s) => s.id === "avatar")?.output as
        | { videoUrl?: string; durationSec?: number }
        | undefined;
      if (!avatar?.videoUrl) return null;
      const line =
        (job.config as SpeakingConfig).saying?.trim() ||
        (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)?.text;

      const res = await fetch(avatar.videoUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const storageId = await ctx.storage.store(blob);
      const assetId = await ctx.runMutation(internal.assets.record, {
        clientId,
        storageId,
        mimeType: "video/mp4",
        bytes: blob.size,
        durationSec: avatar.durationSec,
        hookKind: "speaking",
        hookLine: line || undefined,
      });
      // Noted on the step, so "Add captions" / "Edit captions again" can
      // reopen the studio on this clip rather than render the speaker again.
      await ctx.runMutation(internal.jobs.patchStep, {
        jobId,
        stepId: "avatar",
        output: { ...avatar, assetId },
      });
    } catch (e) {
      console.warn(`couldn't keep the hook for job ${jobId}:`, e instanceof Error ? e.message : e);
    }
    return null;
  },
});

/** The hook as a playable video: a reused one, or the speaker this run rendered. */
async function speakerClip(ctx: ActionCtx, job: Doc<"jobs">, clientId: Id<"clients">): Promise<string> {
  const config = job.config as SpeakingConfig;
  if (config.speaker && isVideoRef(config.speaker)) return (await resolveVideo(ctx, config.speaker, clientId)).url;
  const rendered = (job.steps.find((s) => s.id === "avatar")?.output as { videoUrl?: string } | undefined)
    ?.videoUrl;
  if (!rendered) throw new Error("The speaker has not been rendered yet.");
  return rendered;
}

/**
 * Parks the run in the caption studio -- Video Hook & Demo's -- over the
 * speaker, with the Captions box's line in the hook look, or what they say
 * when that was left blank. The speaker plays in full, in their own voice,
 * so the preview neither loops early nor lays music over them.
 */
export const openStudio = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "style", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SpeakingConfig;

    const line =
      config.caption?.trim() ||
      config.saying?.trim() ||
      (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)?.text?.trim() ||
      "";

    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "style",
      output: {
        design: config.design ? sanitizeDesign(config.design) : hookCaptionDesign(line),
        videoUrl: await speakerClip(ctx, job, clientId),
        audioUrl: null,
        previewSeconds: null,
      },
    });
    return null;
  },
});

/** P7 + P8 in one hop, reusing Video Hook & Demo's exact renderer: two segments, caption on the first. */
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as SpeakingConfig;
    if (!config.demoVideo) throw new Error("A demo video upload is required.");

    const hookUrl = await speakerClip(ctx, job, clientId);

    const demoAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.demoVideo,
    });
    if (!demoAsset) throw new Error("The demo video upload could not be found.");
    const demoUrl = await ctx.storage.getUrl(demoAsset.storageId);
    if (!demoUrl) throw new Error("The demo video upload could not be read.");

    // The studio's design, when this run went through it: burned onto the
    // speaker clip first, in a pass of its own. Add captions switched off
    // skips the studio and means no caption at all. A job from before the
    // studio has no "style" step either, and keeps its Subtitle style burn-in
    // ("None" being no subtitles at all).
    const approved = (job.steps.find((s) => s.id === "style")?.output as { design?: unknown } | undefined)
      ?.design;
    const design = approved ? sanitizeDesign(approved) : null;
    const captioned = design && hasText(design) ? await captionHook(ctx, hookUrl, design, MAX_HOOK_SECONDS) : null;
    const captionText =
      approved || config.captions === false || config.captionStyle === "None"
        ? ""
        : config.saying?.trim() ||
          ((job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)?.text ?? "");

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/video-hook-demo`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        hookUrl: captioned?.url ?? hookUrl,
        demoUrl,
        dimensions: "9:16",
        captionText,
        captionStyle: config.captionStyle ?? "Classic",
        // The whole line, however long: the renderer's default trims a hook.
        hookSeconds: 0,
        uploadUrl,
      }),
    });
    // The captioned clip was only ever an input to this render.
    if (captioned) await ctx.storage.delete(captioned.storageId);
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
      output: { files: [{ name: "output.mp4" }], ...(design ? { design } : {}) },
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
