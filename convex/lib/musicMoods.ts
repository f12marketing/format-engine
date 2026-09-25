/**
 * The music popup's mood chips, and the Freesound query each one runs.
 * Shared by the popup (the chip labels) and convex/music.ts (the queries).
 *
 * One word each: Freesound's text search requires every word to match, so
 * "upbeat energetic" found a single track where "upbeat" finds dozens.
 */
export const MOODS: Record<string, string> = {
  Upbeat: "upbeat",
  Chill: "chill",
  "Lo-fi": "lofi",
  Cinematic: "cinematic",
  Emotional: "emotional",
  Happy: "happy",
  Corporate: "corporate",
  "Hip hop": "hiphop",
  // Plain "acoustic" takes Freesound ~40s to answer and "guitar" alone
  // surfaces metal riffs; this finds 140 strummed tracks in a few seconds.
  Acoustic: "acoustic guitar",
  Electronic: "electronic",
};
