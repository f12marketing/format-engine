import type { ActionCtx } from "../_generated/server";
import { submitWithContentPolicyFallback } from "./fal";
import { renderServiceBase, renderServiceHeaders } from "./renderService";

/**
 * P3, the image-to-video step, in one place.
 *
 * Every animating format used `fal-ai/vidu/q3/image-to-video/turbo`, which
 * cannot be told what NOT to draw, cannot be given a character to hold to,
 * and cannot be told where to finish. Skeleton's rebuild showed what that
 * costs: drifting characters, mangled hands and cuts that don't join. Kling
 * v3 takes all three -- `negative_prompt`, `elements` and `end_image_url` --
 * for about 9% more than vidu at the Standard tier.
 *
 * It also caps a single generation at 15 seconds, which vidu did at 16. Every
 * caller used to pass the user's full duration straight through, so a 30s
 * Claymation was asking for nearly twice what the model would accept;
 * `segmentLengths` and `animateChained` below are what make a 60s clip out of
 * a model that will only ever give you 15 at a time.
 */

export const CLIP_MODELS: Record<string, string> = {
  "Kling 3 Pro": "fal-ai/kling-video/v3/pro/image-to-video",
  "Kling 3 Standard": "fal-ai/kling-video/v3/standard/image-to-video",
};
/**
 * Standard, not Pro. Measured head to head on the same story and the same
 * staged frames (test-outputs/2026-09-19/skeleton-chef-v2*), Standard held
 * the character, the set and the hands just as well for 25% less and in half
 * the time. Pro stays available per format for a final render.
 */
export const DEFAULT_CLIP_MODEL = "Kling 3 Standard";

/** Rates with audio off -- narration is laid on in the render, not sung by Kling. */
export const CLIP_PER_SEC: Record<string, number> = {
  "fal-ai/kling-video/v3/pro/image-to-video": 0.112,
  "fal-ai/kling-video/v3/standard/image-to-video": 0.084,
};

/** Kling's own floor and ceiling for one generation. */
export const MIN_CLIP_SECONDS = 3;
export const MAX_CLIP_SECONDS = 15;

/**
 * What no model should ever draw. Hands are the recurring failure across
 * every format -- bone hands in Skeleton, clay hands in Claymation, a
 * presenter's hands in a product shot -- so they lead the list.
 */
export const NEGATIVE_PROMPT =
  "extra fingers, missing fingers, fused fingers, malformed hands, deformed hands, " +
  "extra limbs, extra arms, detached limbs, floating limbs, disconnected joints, " +
  "warped face, morphing anatomy, melting features, flickering, " +
  "blurry, distorted, low quality, subtitles, captions, on-screen text, watermark";

export function clipModelFor(videoModel: string | undefined): string {
  return CLIP_MODELS[videoModel ?? ""] ?? CLIP_MODELS[DEFAULT_CLIP_MODEL];
}
export function clipRate(model: string): number {
  return CLIP_PER_SEC[model] ?? CLIP_PER_SEC[CLIP_MODELS[DEFAULT_CLIP_MODEL]];
}

/**
 * Whole seconds per generation, adding up to `total`, each within the model's
 * range. A 30s clip becomes two 15s segments; a 40s clip three of 14, 13 and
 * 13 rather than 15, 15 and 10, so no segment is conspicuously shorter.
 * Mirrored by skeletonShots()/segmentCount() in src/lib/estimate.ts.
 */
export function segmentLengths(total: number): number[] {
  const seconds = Math.max(MIN_CLIP_SECONDS, Math.round(total));
  const n = Math.ceil(seconds / MAX_CLIP_SECONDS);
  const base = Math.floor(seconds / n);
  return Array.from({ length: n }, (_, i) => base + (i < seconds % n ? 1 : 0));
}

/** An `elements` entry. Kling rejects a frontal image with no reference images. */
export function characterElement(frontalUrl: string, alsoSeenIn?: string) {
  return {
    frontal_image_url: frontalUrl,
    reference_image_urls: alsoSeenIn ? [alsoSeenIn] : [frontalUrl],
  };
}

export interface ClipRequest {
  model: string;
  startImageUrl: string;
  /** The frame to finish on -- the next shot's opening frame, for a match cut. */
  endImageUrl?: string;
  /** Character references, held across the whole clip as @Element1, @Element2... */
  elements?: ReturnType<typeof characterElement>[];
  seconds: number;
  prompt: string;
  /** Last resort if the content checker refuses the prompt twice. */
  minimalPrompt: () => string;
}

/** One Kling generation. */
export async function animateClip(req: ClipRequest): Promise<string> {
  const result = (await submitWithContentPolicyFallback(
    req.model,
    (prompt) => ({
      prompt,
      start_image_url: req.startImageUrl,
      ...(req.endImageUrl ? { end_image_url: req.endImageUrl } : {}),
      ...(req.elements?.length ? { elements: req.elements } : {}),
      negative_prompt: NEGATIVE_PROMPT,
      duration: String(Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, req.seconds))),
      generate_audio: false,
    }),
    req.prompt,
    req.minimalPrompt,
    { timeoutMs: 8 * 60_000 },
  )) as { video?: { url?: string } };
  const url = result.video?.url;
  if (!url) throw new Error("no clip returned");
  return url;
}

/** The last frame of a clip, stored in Convex and returned as a URL. */
export async function lastFrameUrl(ctx: ActionCtx, videoUrl: string): Promise<string> {
  const res = await fetch(`${renderServiceBase()}/frame/last`, {
    method: "POST",
    headers: renderServiceHeaders(),
    body: JSON.stringify({ videoUrl }),
  });
  if (!res.ok) throw new Error(`could not read the last frame: ${res.status} ${await res.text()}`);
  const out = (await res.json()) as { ok?: boolean; base64?: string; error?: string };
  if (!out.ok || !out.base64) throw new Error(`could not read the last frame: ${out.error ?? "?"}`);
  const storageId = await ctx.storage.store(
    new Blob([Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0))], { type: "image/png" }),
  );
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error("could not read back the extracted frame");
  return url;
}

/**
 * A clip of any length, as one or more chained generations: each segment
 * starts on the previous one's final frame, so the motion carries across the
 * joins instead of snapping back to the opening pose.
 *
 * Returns every segment's URL. A caller wanting a single file stitches them
 * with `stitchSegments`.
 */
export async function animateChained(
  ctx: ActionCtx,
  total: number,
  build: (args: { seconds: number; startImageUrl: string; index: number; of: number }) => ClipRequest,
): Promise<{ urls: string[]; seconds: number[] }> {
  const seconds = segmentLengths(total);
  const urls: string[] = [];
  let startImageUrl: string | null = null;
  for (const [i, s] of seconds.entries()) {
    const req = build({
      seconds: s,
      // The first segment's start frame is the caller's; every later one
      // picks up exactly where the previous segment stopped.
      startImageUrl: startImageUrl ?? "",
      index: i,
      of: seconds.length,
    });
    const url = await animateClip(startImageUrl ? { ...req, startImageUrl } : req);
    urls.push(url);
    if (i < seconds.length - 1) startImageUrl = await lastFrameUrl(ctx, url);
  }
  return { urls, seconds };
}

/**
 * Joins segments into one file on the render service (ffmpeg, free), and
 * returns its Convex URL. One segment is returned untouched.
 */
export async function stitchSegments(
  ctx: ActionCtx,
  segments: { url: string; seconds: number }[],
): Promise<string> {
  if (segments.length === 1) return segments[0].url;
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const res = await fetch(`${renderServiceBase()}/render/video-animation`, {
    method: "POST",
    headers: renderServiceHeaders(),
    body: JSON.stringify({
      shots: segments.map((s) => ({
        videoUrl: s.url,
        audioUrl: null,
        durationSec: s.seconds,
        caption: null,
      })),
      dimensions: "9:16",
      uploadUrl,
    }),
  });
  if (!res.ok) throw new Error(`could not join the clip segments: ${res.status} ${await res.text()}`);
  const out = (await res.json()) as { storageId: string };
  const url = await ctx.storage.getUrl(out.storageId as never);
  if (!url) throw new Error("could not read back the joined clip");
  return url;
}
