/**
 * The line a voice preview speaks, and what it costs.
 *
 * Kept short on purpose: eleven-v3 bills by character, and a preview is
 * clicked many times while someone auditions twenty-one voices. Around forty
 * characters is under half a cent a listen.
 *
 * One sample per language. Only English is offered today (`LANGUAGES` in
 * src/formats/fields.ts), and a language with no sample here falls back to
 * English rather than having English text read with another language's rules.
 *
 * Plain data with no imports, so the client bundle can take it as-is -- the
 * button shows the price and the action speaks the text, from this one place.
 */
const SAMPLE_TEXT: Record<string, string> = {
  en: "Hi, this is how your voiceover will sound.",
};

const FALLBACK_LANGUAGE = "en";

/** fal-ai/elevenlabs/tts/eleven-v3, per 1000 characters. */
export const VOICE_SAMPLE_PRICE_PER_1000_CHARS = 0.1;

export function voiceSample(language?: string): { language: string; text: string } {
  const code = language && SAMPLE_TEXT[language] ? language : FALLBACK_LANGUAGE;
  return { language: code, text: SAMPLE_TEXT[code] };
}

export function voiceSampleCostUsd(language?: string): number {
  return (voiceSample(language).text.length / 1000) * VOICE_SAMPLE_PRICE_PER_1000_CHARS;
}
