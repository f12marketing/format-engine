import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { callSync } from "./fal";
import { stabilityOf } from "./extras";
import type { ExtrasConfig } from "./extras";
import {
  MAX_SCENES,
  SCENE_SECONDS,
  SCRIPT_MAX_CHARS,
  sceneCountFor,
  speechSeconds,
  tidyScript,
  windowsFor,
} from "./scriptTiming";

/**
 * The step every script-driven video begins with -- record the script -- shared
 * by Slideshow and Video Animation so the two cannot drift apart on how a
 * script becomes a length. See scriptTiming.ts for how the length becomes
 * scenes.
 */

const TTS_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";
const TTS_PRICE_PER_1000_CHARS = 0.1;

// ---------------------------------------------------------------- the voiceover (P4)

export interface NarratedScript {
  /** Exactly what was spoken. */
  script: string;
  audioUrl: string;
  /** How long it takes to say -- X. */
  seconds: number;
  /** X / 3, rounded up -- Y. */
  sceneCount: number;
  /** The words spoken in each scene's 3-second window; `sceneCount` entries. */
  windows: string[];
  /** False when the speech model returned no timings and the windows are spread by position. */
  timed: boolean;
}

/**
 * Records the whole script in one go and measures it.
 *
 * One call rather than one per slide or shot, deliberately: this is the
 * voiceover the video is cut to, and one continuous read has one continuous
 * rhythm. The per-scene words come from the model's own word timings, so an
 * image about the Red Sea is on screen while the Red Sea is being spoken.
 */
export async function narrateScript(
  ctx: ActionCtx,
  args: {
    jobId: Id<"jobs">;
    clientId: Id<"clients">;
    script: string;
    config: ExtrasConfig;
  },
): Promise<NarratedScript> {
  const { jobId, clientId, config } = args;
  const script = tidyScript(args.script);
  if (!script) throw new Error("There is no script to record.");
  // The form caps this, but the form is not the boundary: the voice is billed
  // by the character and every three seconds of it becomes a paid scene.
  if (script.length > SCRIPT_MAX_CHARS) {
    throw new Error(`The script is ${script.length} characters; the limit is ${SCRIPT_MAX_CHARS}.`);
  }

  const costUsd = (script.length / 1000) * TTS_PRICE_PER_1000_CHARS;
  await ctx.runMutation(internal.ledger.assertUnderCap, {
    clientId,
    aboutToSpendUsd: costUsd * 1.2,
  });

  const result = (await callSync(TTS_MODEL, {
    text: script,
    voice: config.voice ?? "Sarah",
    stability: stabilityOf(config),
    language_code: config.language ?? "en",
    apply_text_normalization: "auto",
    // Per-character timings, which is what lets each scene be given the words
    // actually spoken during it.
    timestamps: true,
  })) as { audio?: { url?: string }; timestamps?: unknown };
  const audioUrl = result.audio?.url;
  if (!audioUrl) throw new Error("no audio returned for the script");

  const { seconds, timed } = speechSeconds(script, result.timestamps);
  const sceneCount = sceneCountFor(seconds);
  if (sceneCount > MAX_SCENES) {
    throw new Error(
      `That script runs about ${Math.round(seconds)} seconds, which is ${sceneCount} scenes of ` +
        `${SCENE_SECONDS}s -- the most a video can have is ${MAX_SCENES}. Shorten the script.`,
    );
  }

  await ctx.runMutation(internal.ledger.record, {
    clientId,
    jobId,
    stepId: "voice",
    primitive: "P4",
    model: TTS_MODEL,
    units: script.length,
    unitLabel: "characters",
    costUsd,
  });

  return {
    script,
    audioUrl,
    seconds,
    sceneCount,
    windows: windowsFor(script, result.timestamps, sceneCount),
    timed,
  };
}

// ---------------------------------------------------------------- reading a tool call

/**
 * The array under `key` in a planner's tool-call arguments, however the model
 * wrapped it.
 *
 * Seen for real once a numbered script was in the prompt: the arguments came
 * back as `{"slides": "{\"slides\": [...]}"}` -- the whole answer JSON-encoded
 * a second time inside the argument. A string is also "long enough" for a
 * length check and then has no `.map`, which is how it first surfaced. So this
 * unwraps up to a few layers of string and `{key}` object until an array
 * appears; anything that never resolves to one is no answer at all, and the
 * caller's own "needed N, got 0" error says so plainly.
 */
export function listFrom<T>(value: unknown, key: string): T[] {
  let cur: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof cur === "string") {
      try {
        cur = JSON.parse(cur);
      } catch {
        return [];
      }
    }
    if (Array.isArray(cur)) return cur as T[];
    if (cur && typeof cur === "object" && key in cur) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return [];
    }
  }
  return Array.isArray(cur) ? (cur as T[]) : [];
}
