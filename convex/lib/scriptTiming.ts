/**
 * From a spoken script to a scene count, and to the words each scene covers.
 *
 * Slideshow and Video Animation are cut to their voiceover, not the other way
 * round. The script is recorded first; how long it took to say (X seconds)
 * decides how many scenes there are (X / 3, rounded up); and every scene is
 * given the words that are actually being spoken while it is on screen. So
 * nobody is ever asked how long the video should be -- the script already says.
 *
 * The words for a scene come from the speech model's own timings, not from a
 * guess: eleven-v3 can return when each character is spoken, and the
 * characters it returns are the script's, in order. A word belongs to the
 * scene its first letter is spoken in.
 *
 * Plain data and pure functions with no imports, so the client bundle can take
 * the limits and the estimate as-is (same as carouselTemplates.ts).
 */

/** Every scene, image or clip, stays up this long. */
export const SCENE_SECONDS = 3;

/**
 * The longest script accepted. eleven-v3 bills by the character and every 3
 * seconds of speech is a whole image or clip, so this bounds the cost of a run
 * as much as the length of the video: 1,500 characters is about 100 seconds,
 * about 34 scenes.
 */
export const SCRIPT_MAX_CHARS = 1500;

/** A ceiling on scenes whatever the script says, so a long read can't fan out unbounded. */
export const MAX_SCENES = 40;

/**
 * eleven-v3's pace, measured: 180 characters took 11.9 seconds. Only used to
 * estimate a cost before the voice exists, or when the timings don't come back.
 */
export const SPEECH_CHARS_PER_SEC = 15;

/**
 * The length the cost estimate assumes until a script has been typed, so the
 * panel shows a typical figure rather than nothing. Thirty seconds is ten
 * scenes. Never used to run anything: a script is required.
 */
export const DEFAULT_SCRIPT_SECONDS = 30;

/** Scenes for a spoken length: X / 3, rounded up so the last words are never cut off. */
export function sceneCountFor(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / SCENE_SECONDS - 1e-6));
}

/** The same, from a script's length, for pricing a run before anything has been spoken. */
export function estimatedSceneCount(scriptChars: number): number {
  const seconds = scriptChars > 0 ? scriptChars / SPEECH_CHARS_PER_SEC : DEFAULT_SCRIPT_SECONDS;
  return sceneCountFor(seconds);
}

/**
 * What goes to the speech model, and what the timings are laid over. Runs of
 * whitespace become single spaces so the characters it returns line up with
 * this string one for one -- a paragraph break would otherwise be a character
 * the two sides could disagree about.
 */
export function tidyScript(script: string): string {
  return script.replace(/\s+/g, " ").trim();
}

interface TimedChunk {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

function chunksOf(timestamps: unknown): TimedChunk[] {
  return Array.isArray(timestamps) ? (timestamps as TimedChunk[]) : [];
}

/** When each character of `script` is spoken, or null if the timings don't line up with it. */
function startTimes(script: string, timestamps: unknown): number[] | null {
  const chunks = chunksOf(timestamps);
  const chars = chunks.flatMap((c) => c.characters ?? []);
  const starts = chunks.flatMap((c) => c.character_start_times_seconds ?? []);
  if (!chars.length || chars.length !== starts.length || chars.join("") !== script) return null;
  return starts.every((t) => Number.isFinite(t)) ? starts : null;
}

/**
 * How long the speech runs, in seconds: the end of the last character spoken.
 * Falls back to the pace estimate when there are no timings.
 */
export function speechSeconds(script: string, timestamps: unknown): { seconds: number; timed: boolean } {
  const ends = chunksOf(timestamps)
    .flatMap((c) => c.character_end_times_seconds ?? [])
    .filter((t) => Number.isFinite(t));
  if (ends.length) return { seconds: Math.max(...ends), timed: true };
  return { seconds: script.length / SPEECH_CHARS_PER_SEC, timed: false };
}

/**
 * The words spoken in each scene's window: scene i covers [3i, 3i + 3)
 * seconds. Joined back in order they are the script, word for word -- a word
 * belongs whole to the scene its first letter is spoken in, never split
 * across two. A scene during a pause has no words.
 *
 * Without usable timings the words are spread by position instead, which is
 * only as good as an even speaking pace but never loses or reorders anything.
 */
export function windowsFor(script: string, timestamps: unknown, sceneCount: number): string[] {
  const times = startTimes(script, timestamps);
  const out: string[][] = Array.from({ length: sceneCount }, () => []);

  for (const match of script.matchAll(/\S+/g)) {
    const at = match.index ?? 0;
    const scene = times
      ? Math.floor(times[at] / SCENE_SECONDS)
      : Math.floor((at / Math.max(1, script.length)) * sceneCount);
    out[Math.min(sceneCount - 1, Math.max(0, scene))].push(match[0]);
  }
  return out.map((words) => words.join(" "));
}
