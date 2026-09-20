import { callTool, type ToolSpec } from "./fal";

/**
 * Spoken copy has to fit the video it's read over. "About N seconds" alone
 * didn't hold: asked for 3 seconds, the narration writer returned 13-18
 * words (5.6-7.2s of speech), and the narrated formats' clip is only as long
 * as the duration setting, so the voice was cut off mid-sentence. A word
 * count is something the model can actually check itself against, and one
 * that is checked here too.
 */

/** How many words fit in `seconds` of speech, never fewer than a usable line. */
export function wordBudget(seconds: number, wordsPerSecond: number): number {
  return Math.max(4, Math.floor(seconds * wordsPerSecond));
}

export function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

/**
 * One forced-tool-call write, plus a single rewrite when the draft runs over
 * `maxWords`. The rewrite is kept even if it still overshoots slightly --
 * narrated renders hold the last frame until the voice ends, so a small
 * overrun lengthens the video rather than losing words.
 */
export async function writeWithinBudget(
  system: string,
  userPrompt: string,
  tool: ToolSpec,
  field: string,
  maxWords: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const read = (value: unknown) =>
    String((value as Record<string, unknown> | null)?.[field] ?? "").trim();

  const first = await callTool(system, userPrompt, tool);
  const draft = read(first.value);
  const words = countWords(draft);
  if (!draft || words <= maxWords) {
    return { text: draft, inputTokens: first.inputTokens, outputTokens: first.outputTokens };
  }

  const second = await callTool(
    system,
    `${userPrompt}\n\nThis draft is ${words} words, over the ${maxWords}-word limit:\n\n` +
      `${draft}\n\nRewrite it in ${maxWords} words or fewer. Keep the hook and the one ` +
      "point that matters most; cut everything else.",
    tool,
  );
  const rewrite = read(second.value);
  return {
    text: rewrite || draft,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
  };
}
