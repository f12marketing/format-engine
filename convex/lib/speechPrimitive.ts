import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callSync } from "./fal";

/**
 * P4, shared by all five avatar formats. Every one of them either generated
 * a script in "copy" (output key "text", see scriptPrimitive.ts) or has one
 * because the caller typed it directly into `textConfigField` and P1 never
 * ran -- same "either P1 wrote it, or the user did" fallback every other
 * format's render step already uses.
 */
const TTS_PRICE_PER_1000_CHARS = 0.1; // fal-ai/elevenlabs/tts/eleven-v3
const AVG_SPEECH_CHARS_PER_SEC = 15;

export const generateSpeech = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    /** Which config field holds the text when the copy step didn't run. */
    textConfigField: v.string(),
    voice: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, clientId, textConfigField, voice }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "speech", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const written = (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)
      ?.text;
    const config = job.config as Record<string, unknown>;
    const text = (written ?? (config[textConfigField] as string | undefined) ?? "").trim();
    if (!text) throw new Error("no script to speak");

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
    const result = (await callSync("fal-ai/elevenlabs/tts/eleven-v3", {
      text,
      voice: voice ?? "Sarah",
      stability: 0.5,
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
      output: { audioUrl, estimatedSeconds },
    });
    return null;
  },
});
