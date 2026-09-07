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
  /** fal-ai/vidu/q3 image-to-video, per video-second. */
  viduPerSec: { "360p": 0.035, "540p": 0.035, "720p": 0.077, "1080p": 0.077 },
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
  // Slideshow's own "images" field supplies its real value once the config
  // panel initializes; 1 (not that field's default of 10) is the right
  // fallback for every other P2 format, which composites exactly one image
  // (Product Spokesperson, Green Screen Mobile) and has no such field at all.
  const imageCount = num(values.images, 1);
  const inputWords = words(values.logline) || words(values.prompt);
  const resolution = "720p" as keyof typeof RATES.viduPerSec;

  for (const step of format.pipeline) {
    // Honour the declaration's own skip logic -- a user-written script means
    // no P1 call, and the estimate should say so before the run, not after.
    if (!stepApplies(step, values)) continue;

    const cost = costForStep(step.primitive, {
      duration,
      slideCount,
      imageCount,
      inputWords,
      resolution,
      format,
    });
    if (cost !== null) lines.push({ label: step.label, costUsd: cost });
  }

  return {
    lines,
    totalUsd: lines.reduce((sum, l) => sum + l.costUsd, 0),
  };
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
      const units = ctx.format.preview === "deck" ? 0 : ctx.imageCount;
      return units * RATES.imagePerUnit;
    }

    case "P3":
      return ctx.duration * RATES.viduPerSec[ctx.resolution];

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
