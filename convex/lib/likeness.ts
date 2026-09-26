import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Likeness consent: a real person's photo or video may only be animated,
 * lip-synced, swapped or trained into an influencer with their permission.
 *
 * - Seedance 2.0 rejects a reference photo of a real face outright unless
 *   the person has been verified with ByteDance. Kling, OmniHuman, Wan
 *   Animate and the LoRA trainer don't check, so the app has to ask.
 * - Right-of-publicity laws (e.g. NY Civil Rights Law §§ 50-51, California
 *   Civil Code § 3344, Tennessee's ELVIS Act for voices) make using someone's
 *   likeness in an ad without consent actionable.
 * - EU AI Act art. 50(4) makes a realistic video of a real person saying or
 *   doing something they didn't a deepfake that must be disclosed.
 *
 * The client confirms it once per photo (`uploads.attach` with
 * `likenessConsent`, or `uploads.confirmLikenessConsent` for one already
 * uploaded), and the server refuses a new job or influencer that would use
 * an unconfirmed one. Faces the app generated are synthetic and exempt; so is
 * anything a job produced.
 */
export const LIKENESS_CONSENT_ERROR =
  "Confirm you have permission from the person in your photo before we animate them.";

export function needsLikenessConsent(asset: Doc<"assets">): boolean {
  return !asset.synthetic && asset.producedByJobId === undefined && asset.likenessConsentAt === undefined;
}

/** The `image:<assetId>` refs a roster field (casting, hook) stores for an uploaded photo. */
export function uploadedPhotoRefs(config: unknown): Id<"assets">[] {
  if (!config || typeof config !== "object") return [];
  const ids: Id<"assets">[] = [];
  for (const value of Object.values(config as Record<string, unknown>)) {
    if (typeof value === "string" && value.startsWith("image:")) {
      ids.push(value.slice("image:".length) as Id<"assets">);
    }
  }
  return ids;
}

/** Throws unless every asset is the client's own and needs no (further) consent. */
export async function assertLikenessConsent(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  assetIds: Id<"assets">[],
): Promise<void> {
  for (const assetId of assetIds) {
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.clientId !== clientId) throw new Error("A photo you picked could not be found.");
    if (needsLikenessConsent(asset)) throw new Error(LIKENESS_CONSENT_ERROR);
  }
}
