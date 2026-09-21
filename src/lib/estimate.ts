import { stepApplies } from "@/formats/types";
import type { FormatDefinition, Primitive } from "@/formats/types";

/**
 * The pre-flight cost estimate, driven by a format's pipeline rather than
 * written per format. The old app's dashboard estimator ported across and
 * generalised: it knew about three modes, this knows about primitives, so a
 * new format is costed the day it is declared.
 *
 * Published fal rates at the time of writing. Treat every number as a FLOOR --
 * these are list prices and exclude retries, which on generative video are not
 * rare.
 */

export const RATES = {
  /** Claude Sonnet 5 via the fal OpenRouter passthrough, per 1M tokens. */
  llmInputPer1M: 2.0,
  llmOutputPer1M: 10.0,
  /** fal-ai/nano-banana-2, per image at its 1K default. */
  imagePerUnit: 0.08,
  /** alibaba/qwen-image-3/edit at 1K, per composite. */
  compositePerUnit: 0.04,
  /**
   * fal-ai/vidu/q3 image-to-video, per video-second. No longer used by any
   * format -- kept as the record of what P3 cost before Kling.
   */
  viduPerSec: { "360p": 0.035, "540p": 0.035, "720p": 0.077, "1080p": 0.077 },
  /**
   * fal-ai/kling-video/v3/{pro,standard}/image-to-video, per video-second
   * with audio off -- every format's P3 step. Mirrored by CLIP_PER_SEC in
   * convex/lib/klingClip.ts.
   */
  klingPerSec: { "Kling 3 Pro": 0.112, "Kling 3 Standard": 0.084 } as Record<string, number>,
  /** fal-ai/elevenlabs/tts/eleven-v3, per 1000 characters. */
  ttsPer1000Chars: 0.1,
  /** fal-ai/bytedance/omnihuman/v1.5, per second. The single most expensive line here. */
  avatarPerSec: 0.16,
  /**
   * fal-ai/wan/v2.2-14b/animate/{replace,move}, 480p, per processed second.
   * `decart/lucy-2-5` -- this constant's original name -- turned out to be a
   * real-time WebRTC model with no batch API, discovered live while building
   * Character Swap; this rate happened to already match Wan-Animate's 480p
   * tier exactly, so only the name needed correcting.
   */
  swapPerSec: 0.04,
  /** fal-ai/elevenlabs/voice-changer, $0.30/minute -- Character Swap's voice conversion, not TTS. */
  voiceChangePerSec: 0.005,
  /** openai/gpt-5.6-luna via the fal OpenRouter passthrough -- Drama's writer. */
  dramaLlmInputPer1M: 0.2,
  dramaLlmOutputPer1M: 1.2,
  /** fal-ai/index-tts-2/text-to-speech, per second of speech. */
  indexTtsPerSec: 0.002,
  /** bytedance/seedance-2.0/{fast/,}reference-to-video, per video-second. */
  seedancePerSec: {
    fast: { "720p": 0.2419, "480p": 0.1125 },
    standard: { "720p": 0.3034, "480p": 0.1406 },
  },
  /** fal-ai/elevenlabs/music, per started minute. Drama's score. */
  musicPerMinute: 0.6,
  /** CassetteAI/music-generator, per minute -- Slideshow's score. Checked against fal's pricing endpoint. */
  cassettePerMinute: 0.02,
  /**
   * fal-ai/topaz/upscale/video, per second, tiered by OUTPUT resolution --
   * that is, the source's short edge times the upscale factor, not the
   * source on its own. Gaia 2 is half price at every tier; 60fps doubles it,
   * which nothing here renders at. Carried over from the old app's dashboard
   * estimator, which checked these against fal's own pricing page.
   */
  topazPerSec: { upTo720p: 0.01, upTo1080p: 0.02, above1080p: 0.08 },
  /** fal-ai/workflow-utilities/auto-subtitle, per minute of video. */
  subtitlesPerMinute: 0.03,
} as const;

export interface EstimateLine {
  label: string;
  costUsd: number;
}

export interface Estimate {
  lines: EstimateLine[];
  totalUsd: number;
}

const TOKENS_PER_WORD = 1.35;
const AVG_SPEECH_CHARS_PER_SEC = 15;
/** Mirrors DEFAULT_CLIP_MODEL in convex/lib/klingClip.ts and field.videoModel(). */
const DEFAULT_KLING_TIER = "Kling 3 Standard";
/** The formats whose scene step is convex/lib/clayScenePrimitive.ts. */
const CLAY_FAMILY = new Set(["claymation", "lego", "felt", "talking-objects"]);

function words(text: unknown): number {
  if (typeof text !== "string") return 0;
  return text.trim().match(/\S+/g)?.length ?? 0;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * One case per primitive. A format that adds a step gets costed automatically;
 * a format whose steps are all free (Custom, Wall of Text) totals zero without
 * anyone writing a special case for it.
 */
export function estimateCost(
  format: FormatDefinition,
  values: Record<string, unknown>,
): Estimate {
  const lines: EstimateLine[] = [];

  const duration = num(values.duration, 30);
  const slideCount = num(values.slideCount, 7);
  // 1 is the right default for every P2 format still priced by primitive:
  // they composite exactly one image (Product Spokesperson, Green Screen
  // Mobile) and have no image-count field at all. Slideshow, the one format
  // that does, now prices itself through PER_STEP_COST.
  const imageCount = num(values.images, 1);
  const inputWords = words(values.logline) || words(values.prompt);
  const resolution = "720p" as keyof typeof RATES.viduPerSec;

  for (const step of format.pipeline) {
    // Honour the declaration's own skip logic -- a user-written script means
    // no P1 call, and the estimate should say so before the run, not after.
    if (!stepApplies(step, values)) continue;

    const perStep = PER_STEP_COST[format.id];
    const cost = perStep
      ? perStep(step.id, values)
      : costForStep(step.primitive, {
          duration,
          slideCount,
          imageCount,
          inputWords,
          resolution,
          format,
          values,
        });
    if (cost !== null) lines.push({ label: step.label, costUsd: cost });
  }

  return {
    lines,
    totalUsd: lines.reduce((sum, l) => sum + l.costUsd, 0),
  };
}

/**
 * How many shots Skeleton splits a duration into -- one staged frame each.
 * Mirrors shotLengths() in convex/skeleton.ts, including the clip model's
 * own 3--15s floor and ceiling on a single shot.
 */
function skeletonShots(duration: number): number {
  const total = Math.max(3, Math.round(duration));
  return Math.min(
    Math.max(1, Math.floor(total / 3)),
    Math.max(Math.ceil(total / 15), Math.max(1, Math.round(total / 5))),
  );
}

function costForStep(
  primitive: Primitive,
  ctx: {
    duration: number;
    slideCount: number;
    imageCount: number;
    inputWords: number;
    resolution: keyof typeof RATES.viduPerSec;
    format: FormatDefinition;
    values: Record<string, unknown>;
  },
): number | null {
  switch (primitive) {
    case "P1": {
      // Roughly: a fixed system-prompt floor plus the user's own input, and an
      // output that scales with how many slides or seconds are being written.
      const inputTokens = 1250 + ctx.inputWords * TOKENS_PER_WORD;
      const outputUnits =
        ctx.format.preview === "deck" ? ctx.slideCount * 110 + 160 : ctx.duration * 12 + 200;
      return (
        (inputTokens / 1e6) * RATES.llmInputPer1M +
        (outputUnits / 1e6) * RATES.llmOutputPer1M
      );
    }

    case "P2": {
      // Skeleton stages one frame per shot, with nano-banana-2/edit.
      if (ctx.format.id === "skeleton") return skeletonShots(ctx.duration) * RATES.imagePerUnit;
      // The clay family composites a supplied product into the set (an edit)
      // or, with none, draws the scene from the prompt -- see
      // convex/lib/clayScenePrimitive.ts. The two are different models.
      if (CLAY_FAMILY.has(ctx.format.id)) {
        return ctx.values.productImage ? RATES.compositePerUnit : RATES.imagePerUnit;
      }
      const units = ctx.format.preview === "deck" ? 0 : ctx.imageCount;
      return units * RATES.imagePerUnit;
    }

    case "P3": {
      // Every animating format is on Kling v3 now, at the tier its config
      // picks. vidu's rate is kept above only as the historical record of
      // what these lines used to cost.
      const tier = typeof ctx.values.videoModel === "string" ? ctx.values.videoModel : "";
      return ctx.duration * (RATES.klingPerSec[tier] ?? RATES.klingPerSec[DEFAULT_KLING_TIER]);
    }

    case "P4":
      // Character Swap's "voice" step is audio-to-audio voice conversion,
      // priced per second of input like the swap itself -- not
      // text-to-speech, so the usual chars-per-second formula below would be
      // answering a question this step never asks.
      if (ctx.format.id === "character-swap") return ctx.duration * RATES.voiceChangePerSec;
      return ((ctx.duration * AVG_SPEECH_CHARS_PER_SEC) / 1000) * RATES.ttsPer1000Chars;

    case "P5":
      return ctx.duration * RATES.avatarPerSec;

    case "P6":
      return ctx.duration * RATES.swapPerSec;

    // Composites, typesetting and library reads run on your own hardware or
    // read from cache. Free at the margin, which is exactly why the render
    // service is the highest-leverage thing to get right.
    case "P7":
    case "P8":
    case "P9":
    case "P10":
      return 0;

    default:
      return null;
  }
}

/**
 * Formats whose steps can't be priced from their primitive alone.
 *
 * The primitive table below answers "what does a P3 second cost" with one
 * number, which is right until two steps share a primitive and not a model.
 * Drama's two P2 steps draw wildly different numbers of images; Slideshow's
 * P4 is TTS in one step and a music model in the next, and its P3 is Topaz
 * rather than vidu. Those formats price themselves by step id instead.
 */
const PER_STEP_COST: Record<
  string,
  (stepId: string, values: Record<string, unknown>) => number
> = {
  drama: dramaStepCost,
  slideshow: slideshowStepCost,
  "video-animation": videoAnimationStepCost,
};

/**
 * Video Animation, step by step. It used to be priced from its primitives
 * alone, which undercounted it badly: every P2 step was one image, so a cast
 * and a set of backgrounds cost the same as a single frame, and every clip
 * second was billed at vidu's rate rather than Kling's.
 *
 * The cast size is a typical-story guess -- the real one isn't known until the
 * story is written and the characters extracted -- and so is how much of the
 * runtime is someone speaking. Rates mirror convex/videoAnimation.ts.
 */
const VA_SHOT_SECONDS = 5;
const VA_TYPICAL_CHARACTERS = 4;
const VA_TYPICAL_BACKGROUNDS = 3;
/** Roughly how many shots carry a line of dialogue, and how long a line runs. */
const VA_SPEAKING_SHARE = 0.6;
const VA_DIALOGUE_CHARS = 70;

function videoAnimationStepCost(stepId: string, values: Record<string, unknown>): number {
  const shots = Math.max(1, Math.round(num(values.durationSec, 30) / VA_SHOT_SECONDS));
  const seconds = shots * VA_SHOT_SECONDS;
  const llm = (inputTokens: number, outputTokens: number) =>
    (inputTokens / 1e6) * RATES.llmInputPer1M + (outputTokens / 1e6) * RATES.llmOutputPer1M;

  switch (stepId) {
    case "story":
      return llm(700 + words(values.logline) * TOKENS_PER_WORD, 1200 + shots * 200);
    case "characters":
      // One extraction call, then a sheet per character and a plate per set.
      return (
        llm(1500 + shots * 250, 1200) +
        (VA_TYPICAL_CHARACTERS + VA_TYPICAL_BACKGROUNDS) * RATES.imagePerUnit
      );
    case "shots":
      return llm(2500 + shots * 100, 300 + shots * 250);
    case "scenes":
      // qwen-image-3/edit, a composite per shot.
      return shots * RATES.compositePerUnit;
    case "clips":
      return (
        seconds *
        (RATES.klingPerSec[String(values.videoModel)] ?? RATES.klingPerSec[DEFAULT_KLING_TIER])
      );
    case "voice":
      return ((shots * VA_SPEAKING_SHARE * VA_DIALOGUE_CHARS) / 1000) * RATES.ttsPer1000Chars;
    case "music": {
      // CassetteAI only accepts 10-180 seconds; the renderer loops or trims it.
      const bed = Math.min(180, Math.max(10, seconds));
      return (bed / 60) * RATES.cassettePerMinute;
    }
    case "upscale":
      return seconds * topazPerSecond(values);
    case "subtitles":
      return (seconds / 60) * RATES.subtitlesPerMinute;
    // The stitch is ffmpeg on the render service -- free at the margin.
    default:
      return 0;
  }
}

/**
 * Slideshow, step by step. Every optional stage is already filtered out by
 * `stepApplies` before this is called, so a step reaching here is one that
 * will actually run and be billed.
 *
 * Rates mirror convex/slideshow.ts.
 */
/** A slide's floor. With a voiceover it stretches to however long the line takes. */
const SLIDE_SECONDS = 3;
const SLIDE_SECONDS_SPOKEN = 5;
/** A caption is capped at 90 characters; they land nearer 75 in practice. */
const CAPTION_CHARS = 75;

function slideshowSeconds(values: Record<string, unknown>): number {
  const slides = num(values.images, 10);
  return slides * (values.voiceover ? SLIDE_SECONDS_SPOKEN : SLIDE_SECONDS);
}

/**
 * Composite scenes with nothing uploaded: the writer designs the cast and one
 * reference image is drawn per character. Between one and four; three is the
 * same typical-cast guess Drama uses.
 */
const SLIDESHOW_DESIGNED_CAST = 3;

function slideshowDesignsCast(values: Record<string, unknown>): boolean {
  const uploaded = values.compositeReferenceAssetIds;
  return !(Array.isArray(uploaded) && uploaded.length > 0);
}

/**
 * Topaz is tiered by OUTPUT resolution. Every ratio in render-service's
 * DIMENSIONS map is 1080 on its short edge, so the output tier is decided by
 * the upscale factor alone.
 */
function topazPerSecond(values: Record<string, unknown>): number {
  const factor = Number(values.upscaleFactor) || 2;
  const outputShortEdge = 1080 * factor;
  const rate =
    outputShortEdge <= 720
      ? RATES.topazPerSec.upTo720p
      : outputShortEdge <= 1080
        ? RATES.topazPerSec.upTo1080p
        : RATES.topazPerSec.above1080p;
  return values.upscaleModel === "Gaia 2" ? rate / 2 : rate;
}

function slideshowStepCost(stepId: string, values: Record<string, unknown>): number {
  const slides = num(values.images, 10);
  const seconds = slideshowSeconds(values);

  switch (stepId) {
    case "copy": {
      // One image prompt and one caption per slide, plus the system prompt.
      const inputTokens = 1250 + words(values.prompt) * TOKENS_PER_WORD;
      // A designed cast adds a name and a reference-image prompt each.
      const castTokens =
        values.compositeScenes && slideshowDesignsCast(values)
          ? SLIDESHOW_DESIGNED_CAST * 150
          : 0;
      const outputTokens = 200 + slides * 120 + castTokens;
      return (
        (inputTokens / 1e6) * RATES.llmInputPer1M +
        (outputTokens / 1e6) * RATES.llmOutputPer1M
      );
    }
    case "images":
      return slides * RATES.imagePerUnit;
    // nano-banana-2/edit, not the qwen-image-3/edit the other formats
    // composite with -- so it bills at the flat image rate, not the cheaper
    // composite one. See convex/slideshow.ts for why the model differs.
    case "composite":
      return (
        (slideshowDesignsCast(values) ? SLIDESHOW_DESIGNED_CAST : 0) * RATES.imagePerUnit +
        slides * RATES.imagePerUnit
      );
    case "voice":
      return ((slides * CAPTION_CHARS) / 1000) * RATES.ttsPer1000Chars;
    case "music": {
      // Mirrors convex/slideshow.ts's scoreMusic: the bed is requested before
      // the cut exists, at 6s a spoken slide (the cut itself stretches to fit
      // the voice), and CassetteAI only accepts 10-180 seconds.
      const bed = Math.min(
        180,
        Math.max(10, Math.round(slides * (values.voiceover ? 6 : SLIDE_SECONDS))),
      );
      return (bed / 60) * RATES.cassettePerMinute;
    }
    case "upscale":
      return seconds * topazPerSecond(values);
    case "subtitles":
      return (seconds / 60) * RATES.subtitlesPerMinute;
    // The cut is Chrome and ffmpeg on the render service -- free at the margin.
    default:
      return 0;
  }
}

/**
 * Drama is priced by step id rather than by primitive: its two P2 steps draw
 * very different numbers of images (a handful of cast sheets, then a frame
 * per beat), and its P3 is Seedance rather than vidu. Rates mirror
 * convex/drama.ts; the cast and speech shares are typical-episode guesses,
 * since the real cast isn't known until the script is written.
 */
const DRAMA_TYPICAL_CAST = 3;
const DRAMA_TYPICAL_SETS = 2;
/** Roughly how much of an episode's running time is someone talking. */
const DRAMA_SPOKEN_SHARE = 0.7;

function dramaStepCost(stepId: string, values: Record<string, unknown>): number {
  const seconds = num(values.durationSec, 45);
  const beats = Math.min(15, Math.max(5, Math.round(seconds / 6)));
  const llm = (inputTokens: number, outputTokens: number) =>
    (inputTokens / 1e6) * RATES.dramaLlmInputPer1M +
    (outputTokens / 1e6) * RATES.dramaLlmOutputPer1M;

  switch (stepId) {
    case "script":
      return llm(2500 + words(values.premise) * TOKENS_PER_WORD, beats * 180 + 900);
    case "cast":
      return (
        (DRAMA_TYPICAL_CAST + DRAMA_TYPICAL_SETS) * RATES.imagePerUnit +
        ((DRAMA_TYPICAL_CAST * 70) / 1000) * RATES.ttsPer1000Chars
      );
    case "storyboard":
      return beats * RATES.imagePerUnit + llm(beats * 250 + 1200, beats * 220);
    case "voices":
      return seconds * DRAMA_SPOKEN_SHARE * RATES.indexTtsPerSec;
    case "scenes": {
      const tier = values.videoModel === "Seedance 2.0" ? "standard" : "fast";
      const res = values.resolution === "480p" ? "480p" : "720p";
      return seconds * RATES.seedancePerSec[tier][res];
    }
    case "music":
      return Math.ceil(seconds / 60) * RATES.musicPerMinute;
    // The cut is ffmpeg on the render service -- free at the margin.
    default:
      return 0;
  }
}
