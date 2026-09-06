import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { submitWithContentPolicyFallback } from "./fal";

/**
 * P5, shared by all five avatar formats -- every one of them names this step
 * "avatar" and the step immediately before it "speech", so one action can
 * read both by id rather than five copies threading the same two URLs
 * through their own workflow.
 *
 * The driving image is resolved two ways: if a "composite" step exists and
 * produced one (Product Spokesperson, Green Screen Mobile -- the avatar has
 * been placed with a product or a phone first), that composite IS the
 * driving image; otherwise it's the roster avatar's own reference portrait.
 * Exactly one of those two exists for any given format's pipeline, so this
 * needs no format-specific branch.
 *
 * fal-ai/bytedance/omnihuman/v1.5 over fal-ai/infinitalk: infinitalk caps at
 * 721 frames (well under 30s at any plausible fps), while omnihuman v1.5
 * natively supports up to 60s of audio at 720p -- matching this app's
 * duration field's full range with no need to chunk speech into segments and
 * re-stitch, the way Video Animation has to for its shots.
 */
const AVATAR_MODEL = "fal-ai/bytedance/omnihuman/v1.5";
const AVATAR_PRICE_PER_SEC = 0.16;
const DEFAULT_PROMPT =
  "Natural, confident on-camera delivery, subtle head movement, direct eye contact with the camera.";

export const renderAvatarClip = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    /** The roster avatar to animate, when no composite step supplies the image instead. */
    avatarId: v.optional(v.id("avatars")),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, clientId, avatarId, prompt }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "avatar", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const compositeUrl = (
      job.steps.find((s) => s.id === "composite")?.output as { imageUrl?: string } | undefined
    )?.imageUrl;

    let imageUrl = compositeUrl;
    if (!imageUrl) {
      if (!avatarId) throw new Error("No avatar selected, and no composite step produced an image.");
      const avatar = await ctx.runQuery(internal.avatars.getInternal, { avatarId });
      if (!avatar) throw new Error("The selected avatar no longer exists.");
      const refAssetId = avatar.referenceAssetIds[0];
      if (!refAssetId) throw new Error("The selected avatar has no reference image.");
      const asset = await ctx.runQuery(internal.assets.getInternal, { assetId: refAssetId });
      if (!asset) throw new Error("The avatar's reference image could not be found.");
      imageUrl = (await ctx.storage.getUrl(asset.storageId)) ?? undefined;
      if (!imageUrl) throw new Error("The avatar's reference image could not be read.");
    }

    const speech = job.steps.find((s) => s.id === "speech")?.output as
      | { audioUrl?: string; estimatedSeconds?: number }
      | undefined;
    if (!speech?.audioUrl) throw new Error("The voice has not been generated yet.");
    const expectedSeconds = speech.estimatedSeconds ?? 30;

    // Generous ceiling (20% over the estimate) rather than the exact expected
    // cost -- the estimate is a words-per-second heuristic, not a probe of
    // the real audio, and this must not fail a legitimate run over it.
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: expectedSeconds * AVATAR_PRICE_PER_SEC * 1.2,
    });

    const buildInput = (p: string) => ({
      image_url: imageUrl,
      audio_url: speech.audioUrl,
      prompt: p,
      resolution: "720p",
    });

    const result = (await submitWithContentPolicyFallback(
      AVATAR_MODEL,
      buildInput,
      prompt?.trim() || DEFAULT_PROMPT,
      () => "Natural speaking delivery.",
      { timeoutMs: 9 * 60_000 },
    )) as { video?: { url?: string }; duration?: number };

    const videoUrl = result.video?.url;
    if (!videoUrl) throw new Error("omnihuman returned no video url");
    const durationSec = result.duration ?? expectedSeconds;

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "avatar",
      primitive: "P5",
      model: AVATAR_MODEL,
      units: durationSec,
      unitLabel: "seconds",
      costUsd: durationSec * AVATAR_PRICE_PER_SEC,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "avatar",
      state: "done",
      output: { videoUrl, durationSec },
    });
    return null;
  },
});
