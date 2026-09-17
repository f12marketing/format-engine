/**
 * The reference-portrait prompt, shared by every place this app generates a
 * synthetic face: avatars (P10), influencer training photos, and the
 * curated gallery. All three used to carry their own near-identical copy of
 * this wording -- one string to tune instead of three to keep in sync.
 *
 * Tuned against the two failure modes a plain portrait request hits most on
 * `fal-ai/nano-banana-2`-class models: the "AI face" look (over-smoothed,
 * plastic skin, soft-focus eyes) and stray artifacts (a half-formed second
 * face, an extra hand, a watermark-shaped smudge in a corner). Naming a real
 * camera/lens pushes the model toward a photograph rather than a render;
 * naming the specific artifacts in the negative list works better than a
 * vague "no defects" -- these models respond to concrete nouns, not
 * abstractions.
 */
const CAMERA_DIRECTION =
  "Shot on a full-frame DSLR with an 85mm portrait lens at f/2.8 for natural " +
  "background separation, tack-sharp focus on the eyes, natural skin texture " +
  "with visible pores and fine detail, no airbrushing or plastic-smooth skin.";

const COMPOSITION_DIRECTION =
  "Shoulders-up framing, facing the camera directly, neutral seamless studio " +
  "background, soft even three-point lighting, calm relaxed expression.";

const NEGATIVE_DIRECTION =
  "Single person only, no extra limbs or duplicated features, no text, no " +
  "watermark, no logo, no visible camera or studio equipment in frame.";

/** The full prompt -- `subject` is whatever free-text description names who to draw. */
export function referencePortraitPrompt(subject: string): string {
  return (
    `Reference portrait photo. ${subject}. ${CAMERA_DIRECTION} ` +
    `${COMPOSITION_DIRECTION} ${NEGATIVE_DIRECTION}`
  );
}

/**
 * The content-policy fallback rung -- deliberately generic (no `subject`)
 * for the same reason every other fallback in this codebase drops
 * caller-supplied detail: whatever in the original prompt triggered the
 * rejection might still be in `subject`, so the retry describes only a
 * bare studio portrait and lets the composite step (which already has the
 * reference image) carry the rest.
 */
export const REFERENCE_PORTRAIT_FALLBACK =
  `Photorealistic reference portrait photo. ${CAMERA_DIRECTION} ` +
  `${COMPOSITION_DIRECTION} ${NEGATIVE_DIRECTION}`;
