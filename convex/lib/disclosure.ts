import type { Doc } from "../_generated/dataModel";

/**
 * AI disclosure: what a post says about the AI in it, and when.
 *
 * Two rules need the disclosure IN the ad, visible to a viewer, rather than
 * only as a platform setting:
 *  - New York GBL § 396-b (in force 9 June 2026): an ad that includes a
 *    "synthetic performer" -- a digitally created person who isn't any
 *    identifiable real one -- must conspicuously say so.
 *  - EU AI Act art. 50(4) (in force 2 August 2026): whoever publishes a
 *    realistic AI-generated video of people ("deepfake") must disclose it
 *    clearly, at the latest on first exposure.
 * The platforms' own AI labels (TikTok's video_made_with_ai, YouTube's
 * containsSyntheticMedia, Instagram's isAiGenerated) are set as well, but a
 * label the platform may or may not show is not the advertiser's disclosure.
 *
 * The caption line is the disclosure this app can guarantee today; it is
 * the first line, so it sits above every platform's "more" fold.
 */
export const AI_PERSON_DISCLOSURE = "Made with AI · features an AI-generated person";

/**
 * The steps that put a generated person on screen: image-to-video (a staged
 * selfie, a reaction, a drama beat), avatar/lipsync, and character swap. A
 * job whose person is the client's own footage (a hook from My videos, a
 * trending clip) plans none of them.
 */
const PERSON_PRIMITIVES = new Set(["P3", "P5", "P6"]);

export function jobShowsAiPerson(job: Pick<Doc<"jobs">, "steps">): boolean {
  return job.steps.some((s) => PERSON_PRIMITIVES.has(s.primitive) && s.state !== "skipped");
}

/** A caption with the disclosure as its first line, once. */
export function withAiDisclosure(caption: string): string {
  const trimmed = caption.trim();
  if (trimmed.startsWith(AI_PERSON_DISCLOSURE)) return trimmed;
  return trimmed ? `${AI_PERSON_DISCLOSURE}\n\n${trimmed}` : AI_PERSON_DISCLOSURE;
}
