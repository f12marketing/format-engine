import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  animateChained,
  clipModelFor,
  clipRate,
  MAX_CLIP_SECONDS,
  stitchSegments,
} from "./klingClip";

/**
 * P3, shared by Claymation, Lego, Felt, Talking Objects, Cutting Fruit, AI
 * News Anchor, Street Interview, Netflix Documentary and On A Walk -- each
 * has exactly one generated scene image to bring to life, with no shot list
 * or per-shot prompt the way Video Animation has. Unlike `avatarPrimitive`
 * (which needs a per-format wrapper because the reference image and prompt
 * both differ per format), this needs no wrapper at all: every caller's
 * "scene" step output is `{ imageUrl }`, and `config.style` names the same
 * field across all those configs, so `run()` can call this directly.
 *
 * Two things changed when Skeleton's rebuild was carried across here:
 *
 *  - the model is Kling v3 rather than vidu turbo, so the prompt can finally
 *    say what not to draw. Hands and faces were the visible failure.
 *  - a clip longer than the model's 15s ceiling is now chained across
 *    segments and joined, instead of being asked for in one call. Every
 *    caller offers up to 60 seconds and passed that straight to a model that
 *    accepted at most 16, so any duration above that was already broken --
 *    it simply had not been tried, since every test run had been short.
 */

export const animateScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { duration?: number; style?: string; videoModel?: string };
    const scene = job.steps.find((s) => s.id === "scene")?.output as
      | { imageUrl?: string }
      | undefined;
    if (!scene?.imageUrl) throw new Error("no scene image to animate");

    const duration = Math.max(1, Math.round(config.duration ?? 30));
    const model = clipModelFor(config.videoModel);
    const rate = clipRate(model);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: duration * rate,
    });

    const mood = config.style ? `Mood: ${config.style}.` : "";
    const { urls, seconds } = await animateChained(ctx, duration, ({ index, of, seconds: s }) => ({
      model,
      startImageUrl: scene.imageUrl!,
      seconds: s,
      prompt:
        (of > 1
          ? `This is part ${index + 1} of ${of} of one continuous take; it carries straight on ` +
            "from the frame it opens on. "
          : "") +
        `Gentle, natural continuous motion within the scene. ${mood} ` +
        "Keep the composition, the subject and the lighting exactly as in the opening frame. " +
        "Faces and hands stay whole and correctly formed as they move, with no warping or " +
        "morphing, and hands keep hold of whatever they are touching.",
      minimalPrompt: () =>
        "Subtle cinematic camera movement and gentle ambient motion. " +
        "Keep the composition exactly as in the opening frame, with no warping or distortion.",
    }));

    // One file, whatever it took to make it: the captions step downstream
    // reads a single `videoUrl` and knows nothing about segments.
    const videoUrl = await stitchSegments(
      ctx,
      urls.map((url, i) => ({ url, seconds: seconds[i] })),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P3",
      model,
      units: duration,
      unitLabel: "seconds",
      costUsd: duration * rate,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clip",
      state: "done",
      output: {
        videoUrl,
        durationSec: duration,
        ...(urls.length > 1 ? { segments: urls.length } : {}),
      },
    });
    return null;
  },
});

/** Re-exported so callers that only animate need one import. */
export { MAX_CLIP_SECONDS };
