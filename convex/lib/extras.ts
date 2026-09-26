import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { submitAndPoll } from "./fal";

/**
 * The production line's optional extras -- music, upscale, subtitles and
 * branding -- shared by every format whose config panel offers them.
 *
 * Slideshow was first, and wrote all of it inline. Video Animation is the
 * second, and the two need the same thing: the same models, the same
 * clamps, the same "replace the job's output with a new one" plumbing. A
 * second copy would be the version that drifts -- one format's stroke-width
 * limit fixed and the other's not -- so it lives here once.
 *
 * Plain functions over an action context, not registered Convex functions:
 * each format wraps the ones it uses in its own tiny `internalAction`, which
 * keeps the workflow's step list explicit and this file free of the
 * self-referential `internal` types that registering functions here would
 * invite.
 *
 * Every function reads the job's frozen config for its settings and writes
 * to a step whose id is the same in both formats -- "music", "upscale",
 * "subtitles" -- which is also what makes the ledger and the job view read
 * the same across them.
 */

/**
 * The settings these steps read. Every field is optional because a job
 * created before a field existed still has to run. Both formats' config
 * types extend this.
 */
export interface ExtrasConfig {
  aspectRatio?: string;
  prompt?: string;
  language?: string;

  startFrameAssetId?: Id<"assets">;
  endFrameAssetId?: Id<"assets">;

  voiceover?: boolean;
  voice?: string;
  voiceStability?: string;

  backgroundMusic?: boolean;
  musicPrompt?: string;
  musicVolume?: string;

  subtitles?: boolean;
  subtitleFont?: string;
  subtitleFontColor?: string;
  subtitleHighlightColor?: string;
  subtitleStrokeColor?: string;
  subtitleStrokeWidth?: number;
  subtitlePosition?: string;
  subtitleWordsPerLine?: number;
  subtitleAnimation?: boolean;

  videoUpscale?: boolean;
  upscaleFactor?: string;
  upscaleModel?: string;
  upscaleH264?: boolean;

  branding?: boolean;
  brandName?: string;
  brandTagline?: string;
  brandLogoAssetId?: Id<"assets">;
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandTextColor?: string;
  brandFont?: string;
  brandClosingMessage?: string;
}

// ---------------------------------------------------------------- aspect ratio

/**
 * The ratios the format pickers offer. Each is valid at every end, checked
 * rather than assumed: render-service's DIMENSIONS map has all five, and so
 * does nano-banana-2's `aspect_ratio` enum (read from fal's Model Search API
 * -- it also takes 21:9, 3:2, 5:4 and 2:3, none of which are offered).
 *
 * 4:3 is deliberately absent. It is a legacy TV ratio with no platform of its
 * own, and YouTube's landscape format is 16:9 -- offering both under YouTube
 * labels was two ways to ask for the same thing.
 */
const ASPECT_RATIOS = new Set(["9:16", "16:9", "1:1", "4:5", "3:4"]);

/**
 * The ratio out of a config value.
 *
 * The picker's options carry a platform name after the ratio ("4:5 —
 * Instagram / LinkedIn post"), so the value is the leading token, checked
 * against the set above rather than trusted. A job from before the labels
 * existed stored a bare "16:9", which is the same token and parses the same.
 */
export function ratioOf(label: string | undefined, fallback: string): string {
  const token = (label ?? "").trim().split(/\s/)[0];
  return ASPECT_RATIOS.has(token) ? token : fallback;
}

// ---------------------------------------------------------------- voice and mix

/**
 * eleven-v3's three stability settings. The old settings page offered a 0-1
 * slider, which v3 does not have -- see convex/lib/speechPrimitive.ts for why
 * `speed`, `similarity_boost` and `style` were dropped with it.
 */
const VOICE_STABILITY: Record<string, number> = {
  Creative: 0.0,
  Natural: 0.5,
  Robust: 1.0,
};

export function stabilityOf(config: ExtrasConfig): number {
  return VOICE_STABILITY[config.voiceStability ?? ""] ?? 0.5;
}

/** How loud the score sits under a voice. Music alone always plays at full level. */
const MUSIC_VOLUME: Record<string, number> = {
  Subtle: 0.08,
  Balanced: 0.14,
  Prominent: 0.25,
};

export function musicVolumeOf(config: ExtrasConfig): number {
  return MUSIC_VOLUME[config.musicVolume ?? ""] ?? MUSIC_VOLUME.Subtle;
}

// ---------------------------------------------------------------- models and rates

/**
 * CassetteAI rather than elevenlabs/music, by choice. Its contract, read from
 * fal's Model Search API: `duration` is an INTEGER of seconds, 10 to 180 --
 * outside that the request is rejected, not clamped -- and the answer is
 * `audio_file.url` (a WAV), not `audio.url`. It has no instrumental switch,
 * so "no vocals" is asked for in the prompt. $0.02 per minute, checked
 * against fal's pricing endpoint.
 */
const MUSIC_MODEL = "CassetteAI/music-generator";
const MUSIC_PER_MINUTE = 0.02;
const MUSIC_MIN_SECONDS = 10;
const MUSIC_MAX_SECONDS = 180;
const UPSCALE_MODEL = "fal-ai/topaz/upscale/video";
const SUBTITLE_MODEL = "fal-ai/workflow-utilities/auto-subtitle";
const SUBTITLES_PER_MINUTE = 0.03;

/**
 * Topaz is tiered by OUTPUT resolution -- source short edge times the factor.
 * Every ratio above renders 1080 on its short edge, so the factor alone
 * decides the tier. Gaia 2 is half price. Mirrored in src/lib/estimate.ts.
 */
const TOPAZ_UP_TO_720P = 0.01;
const TOPAZ_UP_TO_1080P = 0.02;
const TOPAZ_ABOVE_1080P = 0.08;

export function topazPerSecond(config: ExtrasConfig): number {
  const factor = Number(config.upscaleFactor) || 2;
  const outputShortEdge = 1080 * factor;
  const rate =
    outputShortEdge <= 720
      ? TOPAZ_UP_TO_720P
      : outputShortEdge <= 1080
        ? TOPAZ_UP_TO_1080P
        : TOPAZ_ABOVE_1080P;
  return config.upscaleModel === "Gaia 2" ? rate / 2 : rate;
}

// ---------------------------------------------------------------- assets and outputs

/** A stored asset as a URL, for handing to fal or the render service. */
export async function assetUrlOf(
  ctx: ActionCtx,
  assetId: Id<"assets">,
): Promise<string | null> {
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  return asset ? ctx.storage.getUrl(asset.storageId) : null;
}

/**
 * The job's current deliverable, as a URL a fal model can fetch.
 *
 * Upscale and Subtitles are a chain: each takes whatever the last one
 * produced, so neither can name a step to read from. They ask the job what
 * its output is instead -- which is also what makes "subtitles only" and
 * "upscale then subtitles" the same code path.
 */
async function currentOutput(
  ctx: ActionCtx,
  jobId: Id<"jobs">,
): Promise<{ url: string; durationSec?: number }> {
  const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
  const assetId = job?.outputAssetIds?.[job.outputAssetIds.length - 1];
  if (!assetId) throw new Error("the job has no rendered video to work from");
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset) throw new Error("the job's rendered video could not be found");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("the rendered video could not be read back");
  return { url, durationSec: asset.durationSec };
}

/**
 * Stores a fal-hosted video as the job's new output.
 *
 * The previous asset row is left alone rather than deleted: the ledger points
 * at it, and "the cut before it was upscaled" is a thing worth still having
 * when an upscale comes back wrong. Only `outputAssetIds` moves.
 */
async function replaceOutput(
  ctx: ActionCtx,
  args: {
    jobId: Id<"jobs">;
    clientId: Id<"clients">;
    url: string;
    stepId: string;
    name: string;
  },
): Promise<void> {
  const assetId: Id<"assets"> = await ctx.runAction(
    internal.lib.nodeStorage.storeVideoFromUrl,
    { clientId: args.clientId, jobId: args.jobId, url: args.url },
  );

  await ctx.runMutation(internal.jobs.patchStep, {
    jobId: args.jobId,
    stepId: args.stepId,
    state: "done",
    output: { files: [{ name: args.name }] },
  });
  await ctx.runMutation(internal.jobs.setOutputs, {
    jobId: args.jobId,
    assetIds: [assetId],
  });
}

// ---------------------------------------------------------------- bookends and branding

/**
 * What the render service needs to wrap a cut in the client's own start and
 * end videos and a branded title/end card.
 *
 * Folded into the render call rather than run as steps of their own: they are
 * the same ffmpeg work, and a separate step would mean encoding and uploading
 * an intermediate cut for no benefit.
 */
export async function bookendsAndBranding(ctx: ActionCtx, config: ExtrasConfig) {
  const [startVideoUrl, endVideoUrl, logoUrl] = await Promise.all([
    config.startFrameAssetId ? assetUrlOf(ctx, config.startFrameAssetId) : null,
    config.endFrameAssetId ? assetUrlOf(ctx, config.endFrameAssetId) : null,
    config.branding && config.brandLogoAssetId ? assetUrlOf(ctx, config.brandLogoAssetId) : null,
  ]);

  const branding = config.branding
    ? {
        name: (config.brandName ?? "").trim(),
        tagline: (config.brandTagline ?? "").trim(),
        closingMessage: (config.brandClosingMessage ?? "").trim(),
        primaryColor: config.brandPrimaryColor ?? "#111827",
        accentColor: config.brandAccentColor ?? "#e11d48",
        textColor: config.brandTextColor ?? "#ffffff",
        fontFamily: config.brandFont ?? "Montserrat",
        logoUrl,
      }
    : null;

  return { startVideoUrl, endVideoUrl, branding };
}

// ---------------------------------------------------------------- the steps

interface StepArgs {
  jobId: Id<"jobs">;
  clientId: Id<"clients">;
}

/**
 * Background music (P4).
 *
 * The score is generated BEFORE the cut exists, so `wantedSeconds` is the
 * caller's estimate of its length. That is safe in one direction only: the
 * renderer loops a short bed to fill the video but cannot invent one that is
 * too short, so callers should overshoot rather than undershoot.
 */
export async function scoreMusicStep(
  ctx: ActionCtx,
  { jobId, clientId, wantedSeconds, subject }: StepArgs & { wantedSeconds: number; subject: string },
): Promise<void> {
  await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "music", state: "running" });

  const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
  if (!job) throw new Error("unknown job");
  const config = job.config as ExtrasConfig;

  // CassetteAI rejects anything outside 10-180s rather than clamping it, so
  // this clamps for it: a three-slide deck without a voice is ~9s, which
  // would otherwise fail the step. A bed longer than the cut is trimmed by
  // the renderer, and a shorter one is looped.
  const seconds = Math.min(
    MUSIC_MAX_SECONDS,
    Math.max(MUSIC_MIN_SECONDS, Math.round(wantedSeconds)),
  );
  const costUsd = (seconds / 60) * MUSIC_PER_MINUTE;
  await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd });

  const brief = (config.musicPrompt ?? "").trim();
  const prompt = brief
    ? `${brief}. Instrumental only -- no vocals, no lyrics.`
    : `Instrumental bed for a short social video about: ${subject}. ` +
      "Understated, modern, sits under a voice without competing with it. No vocals, no lyrics.";

  const result = (await submitAndPoll(MUSIC_MODEL, {
    prompt,
    duration: seconds,
  })) as { audio_file?: { url?: string } };
  const url = result.audio_file?.url;
  if (!url) throw new Error("no music returned");

  await ctx.runMutation(internal.ledger.record, {
    clientId,
    jobId,
    stepId: "music",
    primitive: "P4",
    model: MUSIC_MODEL,
    units: seconds,
    unitLabel: "seconds",
    costUsd,
  });
  await ctx.runMutation(internal.jobs.patchStep, {
    jobId,
    stepId: "music",
    state: "done",
    output: { url },
  });
}

/**
 * Video upscale (P3): a Topaz pass over whatever the job's output currently
 * is. `fallbackSeconds` prices the run when the asset carries no duration.
 */
export async function upscaleStep(
  ctx: ActionCtx,
  { jobId, clientId, fallbackSeconds }: StepArgs & { fallbackSeconds: number },
): Promise<void> {
  await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "upscale", state: "running" });

  const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
  if (!job) throw new Error("unknown job");
  const config = job.config as ExtrasConfig;

  const { url, durationSec } = await currentOutput(ctx, jobId);
  const seconds = durationSec ?? fallbackSeconds;
  const costUsd = seconds * topazPerSecond(config);

  await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd });

  const result = (await submitAndPoll(
    UPSCALE_MODEL,
    {
      video_url: url,
      upscale_factor: Number(config.upscaleFactor) || 2,
      model: config.upscaleModel ?? "Gaia 2",
      H264_output: config.upscaleH264 !== false,
    },
    // Topaz on a minute of 1080p is slow enough to outlast the default
    // eight-minute poll budget; the action ceiling is ten.
    { timeoutMs: 9 * 60_000 },
  )) as { video?: { url?: string } };
  const upscaledUrl = result.video?.url;
  if (!upscaledUrl) throw new Error("no upscaled video returned");

  await replaceOutput(ctx, {
    jobId,
    clientId,
    url: upscaledUrl,
    stepId: "upscale",
    name: "upscaled.mp4",
  });

  await ctx.runMutation(internal.ledger.record, {
    clientId,
    jobId,
    stepId: "upscale",
    primitive: "P3",
    model: UPSCALE_MODEL,
    units: Math.round(seconds),
    unitLabel: "seconds",
    costUsd,
  });
}

/**
 * Subtitles (P8): word-by-word karaoke captions, transcribed from the job's
 * current output and burned onto it.
 */
export async function subtitlesStep(
  ctx: ActionCtx,
  {
    jobId,
    clientId,
    fallbackSeconds,
    defaultAspect,
  }: StepArgs & { fallbackSeconds: number; defaultAspect: string },
): Promise<void> {
  await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "subtitles", state: "running" });

  const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
  if (!job) throw new Error("unknown job");
  const config = job.config as ExtrasConfig;

  const { url, durationSec } = await currentOutput(ctx, jobId);
  const seconds = durationSec ?? fallbackSeconds;
  const costUsd = (seconds / 60) * SUBTITLES_PER_MINUTE;

  await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd });

  // Font size scales with the frame the same way the caption layers do --
  // width/22 at 1080 wide -- so subtitles occupy the same share of a 9:16
  // cut as of a 16:9 one instead of being tuned for whichever was tested.
  const width = ratioOf(config.aspectRatio, defaultAspect) === "16:9" ? 1920 : 1080;

  const result = (await submitAndPoll(SUBTITLE_MODEL, {
    video_url: url,
    language: config.language ?? "en",
    font_name: config.subtitleFont ?? "Montserrat",
    font_size: Math.round(width / 22),
    font_weight: "bold",
    font_color: config.subtitleFontColor ?? "white",
    highlight_color: config.subtitleHighlightColor ?? "yellow",
    stroke_color: config.subtitleStrokeColor ?? "black",
    // fal accepts 0-10 and rejects anything above; the control stops there
    // too, but a job's config is data, so clamp here as well.
    stroke_width: Math.min(10, Math.max(0, config.subtitleStrokeWidth ?? 4)),
    position: config.subtitlePosition ?? "bottom",
    words_per_subtitle: config.subtitleWordsPerLine ?? 4,
    enable_animation: config.subtitleAnimation !== false,
  })) as { video?: { url?: string } };
  const subtitledUrl = result.video?.url;
  if (!subtitledUrl) throw new Error("no captioned video returned");

  await replaceOutput(ctx, {
    jobId,
    clientId,
    url: subtitledUrl,
    stepId: "subtitles",
    name: "subtitled.mp4",
  });

  await ctx.runMutation(internal.ledger.record, {
    clientId,
    jobId,
    stepId: "subtitles",
    primitive: "P8",
    model: SUBTITLE_MODEL,
    units: Math.round(seconds),
    unitLabel: "seconds",
    costUsd,
  });
}
