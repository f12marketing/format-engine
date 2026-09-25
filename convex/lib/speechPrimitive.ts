import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { VOICES } from "../../src/formats/fields";
import { callSync } from "./fal";
import { resolveRosterPersona, type SpeakerGender } from "./roster";
import { isVideoRef } from "./videoRef";

/**
 * P4, shared by all five avatar formats. Every one of them either generated
 * a script in "copy" (output key "text", see scriptPrimitive.ts) or has one
 * because the caller typed it directly into `textConfigField` and P1 never
 * ran -- same "either P1 wrote it, or the user did" fallback every other
 * format's render step already uses.
 */
const TTS_PRICE_PER_1000_CHARS = 0.1; // fal-ai/elevenlabs/tts/eleven-v3
const AVG_SPEECH_CHARS_PER_SEC = 15;

/**
 * The voice when nobody chose one: matched to whoever is on screen, so a man
 * cast as the speaker doesn't open his mouth and sound like Sarah. The same
 * picks Drama falls back to per gender. Sarah stays the default for a speaker
 * whose gender isn't known -- an uploaded photo, say -- as it always was.
 */
type Voice = (typeof VOICES)[number];
const DEFAULT_VOICE: Voice = "Sarah";
const VOICE_BY_GENDER: Record<SpeakerGender, Voice> = {
  woman: "Sarah",
  man: "Roger",
  nonbinary: "River",
};

/**
 * Resolves the on-screen speaker the same way the avatar step will -- the
 * same function, and for "cast:" the same face, pinned on the job by
 * whichever step drew it first. Best-effort: a voice is not worth failing
 * the run over, and a speaker that can't be resolved fails the avatar step
 * with its own, better message moments later.
 */
async function voiceForSpeaker(
  ctx: ActionCtx,
  ref: string,
  who: { clientId: Id<"clients">; jobId: Id<"jobs"> },
): Promise<Voice> {
  try {
    const { gender } = await resolveRosterPersona(ctx, ref, who);
    return gender ? VOICE_BY_GENDER[gender] : DEFAULT_VOICE;
  } catch (e) {
    console.warn(`couldn't resolve the speaker for a voice (job ${who.jobId}):`, e instanceof Error ? e.message : e);
    return DEFAULT_VOICE;
  }
}

/**
 * A "How they say it" choice, as eleven-v3 audio tags: bracketed directions
 * the model performs rather than reads ("[annoyed] This is hard."). They go
 * on the text sent to TTS only -- never into the job's copy output, which is
 * also the burned-in subtitle.
 *
 * With a direction, stability drops to v3's "Creative" (0): its "Natural"
 * (0.5) and "Robust" (1) settings are documented as increasingly deaf to
 * tags, which would make the choice do nothing audible.
 */
const DELIVERY_TAGS: Record<string, string> = {
  Shocked: "[shocked] [gasps]",
  Outraged: "[outraged]",
  Realising: "[realizing] [slowly]",
  Relieved: "[sighs] [relieved]",
  Deadpan: "[deadpan] [flat]",
  Excited: "[excited]",
  Confused: "[confused] [curious]",
  Smug: "[mischievously] [smug]",
};

export const generateSpeech = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    /** Which config field holds the text when the copy step didn't run. */
    textConfigField: v.string(),
    /** A voice the user chose; wins over anything picked from the speaker. */
    voice: v.optional(v.string()),
    /** Config field holding the on-screen speaker's roster ref, to match the voice to. */
    speakerConfigField: v.optional(v.string()),
    /** Config field holding a "How they say it" choice (see DELIVERY_TAGS). */
    deliveryConfigField: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { jobId, clientId, textConfigField, voice, speakerConfigField, deliveryConfigField },
  ): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "speech", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const written = (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)
      ?.text;
    const config = job.config as Record<string, unknown>;
    const text = (written ?? (config[textConfigField] as string | undefined) ?? "").trim();
    if (!text) throw new Error("no script to speak");

    const speaker = speakerConfigField ? config[speakerConfigField] : undefined;
    const chosenVoice =
      voice ??
      // A finished clip ("video:", "clip:") is nobody to match -- and never
      // reaches here, since reusing one skips the speech step altogether.
      (typeof speaker === "string" && speaker && !isVideoRef(speaker)
        ? await voiceForSpeaker(ctx, speaker, { clientId, jobId })
        : DEFAULT_VOICE);

    const estimatedSeconds = text.length / AVG_SPEECH_CHARS_PER_SEC;
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: (text.length / 1000) * TTS_PRICE_PER_1000_CHARS * 1.2,
    });

    // eleven-v3 rather than turbo-v2.5: the expressive flagship, and
    // turbo-v2.5 was the oldest model left in the stack (Feb 2025). Its
    // schema is narrower -- `similarity_boost`, `style` and `speed` simply
    // do not exist on v3 and were dropped rather than sent and ignored.
    // Twice the price ($0.10 vs $0.05 per 1k chars), which the rate constant
    // above reflects.
    const direction = deliveryConfigField
      ? DELIVERY_TAGS[String(config[deliveryConfigField] ?? "")]
      : undefined;
    const result = (await callSync("fal-ai/elevenlabs/tts/eleven-v3", {
      text: direction ? `${direction} ${text}` : text,
      voice: chosenVoice,
      stability: direction ? 0 : 0.5,
      language_code: (config.language as string | undefined) ?? "en",
      apply_text_normalization: "auto",
    })) as { audio?: { url?: string } };
    const audioUrl = result.audio?.url;
    if (!audioUrl) throw new Error("no audio returned");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "speech",
      primitive: "P4",
      model: "fal-ai/elevenlabs/tts/eleven-v3",
      units: text.length,
      unitLabel: "characters",
      costUsd: (text.length / 1000) * TTS_PRICE_PER_1000_CHARS,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "speech",
      state: "done",
      output: { audioUrl, estimatedSeconds, voice: chosenVoice },
    });
    return null;
  },
});
