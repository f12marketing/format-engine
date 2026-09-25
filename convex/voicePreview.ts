import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { callSync } from "./lib/fal";
import { stabilityOf } from "./lib/extras";
import { enforceRateLimit } from "./lib/rateLimit";
import { voiceSample, voiceSampleCostUsd } from "./lib/voiceSample";

/**
 * "Preview this voice" -- one short line, spoken in the voice, delivery and
 * language the config panel currently has selected, so a narrator can be
 * chosen by ear before a real run spends anything on a whole script.
 *
 * It reads the same three keys the runs do (`voice`, `voiceStability`,
 * `language`) and maps them the same way (`stabilityOf`), so what plays here
 * is what Slideshow and Video Animation will actually generate.
 */
const TTS_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";

/** ElevenLabs' longest premade voice name is well under this; it only bounds what reaches fal. */
const MAX_VOICE_LENGTH = 40;

export const preview = action({
  args: {
    voice: v.string(),
    voiceStability: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, { voice, voiceStability, language }): Promise<{ url: string }> => {
    // Same auth-resolution shape as influencers.generateFaceImage: a public
    // action has no ctx.db, so the admitted client is looked up by identity.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorised. This is an invite-only tool.");

    const name = voice.trim();
    if (!name || name.length > MAX_VOICE_LENGTH) throw new Error("Pick a voice to preview.");

    // Before the spend check, so a burst of clicks is refused cheaply.
    await enforceRateLimit(ctx, "previewVoice", client._id);

    const sample = voiceSample(language);
    const costUsd = voiceSampleCostUsd(language);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId: client._id,
      aboutToSpendUsd: costUsd * 1.2,
    });

    const result = (await callSync(TTS_MODEL, {
      text: sample.text,
      voice: name,
      stability: stabilityOf({ voiceStability }),
      language_code: sample.language,
      apply_text_normalization: "auto",
    })) as { audio?: { url?: string } };
    const url = result.audio?.url;
    if (!url) throw new Error("no audio returned");

    // No job to attach this to -- a preview happens before one exists -- so
    // the row carries no jobId, like influencer training. It still counts
    // against the spend cap.
    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      stepId: "voice-preview",
      primitive: "P4",
      model: TTS_MODEL,
      units: sample.text.length,
      unitLabel: "characters",
      costUsd,
    });

    return { url };
  },
});
