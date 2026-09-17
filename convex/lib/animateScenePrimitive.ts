import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { submitWithContentPolicyFallback } from "./fal";

/**
 * P3, shared by Cutting Fruit, Claymation and Skeleton -- each has exactly
 * one generated scene image to bring to life, with no shot list or per-shot
 * prompt the way Video Animation has. Unlike `avatarPrimitive` (which needs a
 * per-format wrapper because the reference image and prompt both differ per
 * format), this needs no wrapper at all: every caller's "scene" step output
 * is `{ imageUrl }`, and `config.style` names the same field across all three
 * configs, so `run()` can call this directly.
 */
const VIDU_PRICE_PER_SEC = 0.077; // fal-ai/vidu/q3/image-to-video/turbo, 720p

export const animateScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { duration?: number; style?: string };
    const scene = job.steps.find((s) => s.id === "scene")?.output as
      | { imageUrl?: string }
      | undefined;
    if (!scene?.imageUrl) throw new Error("no scene image to animate");

    const duration = Math.max(1, Math.round(config.duration ?? 30));
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: duration * VIDU_PRICE_PER_SEC,
    });

    // vidu can take minutes; leave real headroom under the 10-minute action
    // ceiling, same budget Video Animation's own clip generation uses.
    const buildInput = (prompt: string) => ({
      prompt,
      image_url: scene.imageUrl,
      duration,
      resolution: "720p",
      audio: false, // narration is muxed on separately by the captions step
    });
    const result = (await submitWithContentPolicyFallback(
      "fal-ai/vidu/q3/image-to-video/turbo",
      buildInput,
      `Gentle, natural continuous motion within the scene. ${
        config.style ? `Mood: ${config.style}.` : ""
      } Keep the composition and subject exactly as in the source image, with no warping, ` +
        "morphing or distortion of faces or hands as they move.",
      () =>
        "Subtle cinematic camera movement and gentle ambient motion. " +
        "Keep the composition exactly as in the source image, with no warping or distortion.",
      { timeoutMs: 8 * 60_000 },
    )) as { video?: { url?: string } };
    const videoUrl = result.video?.url;
    if (!videoUrl) throw new Error("no clip returned");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P3",
      model: "fal-ai/vidu/q3/image-to-video/turbo",
      units: duration,
      unitLabel: "seconds",
      costUsd: duration * VIDU_PRICE_PER_SEC,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clip",
      state: "done",
      output: { videoUrl, durationSec: duration },
    });
    return null;
  },
});
