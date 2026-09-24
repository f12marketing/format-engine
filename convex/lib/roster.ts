import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * A roster reference is what `field.avatar()` stores: one plain string naming
 * whoever appears in the video. Convex's id validators can't express a union
 * of tables, so every kind but the original is tagged with a prefix, and a
 * bare id is still read as a P10 avatar -- exactly as every job created before
 * the tags existed has it frozen in its config.
 *
 *   <avatarId>               a P10 avatar (the client's own, or the house roster)
 *   influencer:<id>          a trained influencer
 *   gallery:<id>             a pre-made face from the shared gallery
 *   image:<assetId>          a photo the client uploaded
 *   cast:any|woman|man       "let us cast someone": a gallery face drawn per job
 */
export type RosterRef = string;

export function influencerRosterRef(influencerId: Id<"influencers">): RosterRef {
  return `influencer:${influencerId}`;
}

const INFLUENCER_PREFIX = "influencer:";
const GALLERY_PREFIX = "gallery:";
const IMAGE_PREFIX = "image:";
const CAST_PREFIX = "cast:";

interface RosterPersona {
  imageUrl: string;
  /** Folded into generation prompts the same way `avatar.lookNotes` always was. */
  description: string;
}

/** Who is asking: an uploaded photo is only ever resolved for its owner, and a cast is drawn per job. */
interface Requester {
  clientId: Id<"clients">;
  jobId: Id<"jobs">;
}

async function resolveAssetUrl(ctx: ActionCtx, assetId: Id<"assets">): Promise<string> {
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset) throw new Error("A reference image could not be found.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("Could not read a reference image.");
  return url;
}

async function storageUrl(ctx: ActionCtx, storageId: Id<"_storage">): Promise<string> {
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error("Could not read a reference image.");
  return url;
}

/**
 * A small stable hash, so "cast someone" picks the same face every time it
 * is resolved within one job (several steps resolve it) and, almost always,
 * a different face on the next job.
 */
function pick<T>(pool: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return pool[(h >>> 0) % pool.length];
}

/**
 * Resolves any kind of roster ref to the two things every consumer needs: a
 * photo (P5's lipsync driving image, or one input to a P2 composite) and a
 * short description of who it is. Nothing downstream needs to know which kind
 * of persona it got.
 */
export async function resolveRosterPersona(
  ctx: ActionCtx,
  ref: RosterRef,
  who: Requester,
): Promise<RosterPersona> {
  if (ref.startsWith(CAST_PREFIX)) {
    const want = ref.slice(CAST_PREFIX.length);
    const gender = want === "woman" || want === "man" ? want : undefined;
    const pool = await ctx.runQuery(internal.galleryFaces.castingPool, { gender });
    if (!pool.length) {
      throw new Error("There are no pre-made faces to cast from yet. Pick someone from another tab.");
    }
    const face = pick(pool, `${who.jobId}:${ref}`);
    return {
      imageUrl: await storageUrl(ctx, face.storageId),
      description: `the ${face.gender ?? "person"} in the reference photo`,
    };
  }

  if (ref.startsWith(GALLERY_PREFIX)) {
    const faceId = ref.slice(GALLERY_PREFIX.length) as Id<"galleryFaces">;
    const face = await ctx.runQuery(internal.galleryFaces.getInternal, { faceId });
    // Archived faces still resolve: a job that picked one keeps working.
    if (!face) throw new Error("That pre-made face no longer exists.");
    return {
      imageUrl: await storageUrl(ctx, face.storageId),
      description: `the ${face.gender ?? "person"} in the reference photo`,
    };
  }

  if (ref.startsWith(IMAGE_PREFIX)) {
    const assetId = ref.slice(IMAGE_PREFIX.length) as Id<"assets">;
    const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
    // An id is not an authorisation -- someone else's photo resolves to nothing.
    if (!asset || asset.clientId !== who.clientId || asset.kind !== "image") {
      throw new Error("That photo could not be found.");
    }
    return {
      imageUrl: await storageUrl(ctx, asset.storageId),
      description: "the person in the reference photo",
    };
  }

  if (ref.startsWith(INFLUENCER_PREFIX)) {
    const influencerId = ref.slice(INFLUENCER_PREFIX.length) as Id<"influencers">;
    const influencer = await ctx.runQuery(internal.influencers.getInternal, { influencerId });
    if (!influencer) throw new Error("The selected influencer no longer exists.");
    const assetId = influencer.trainingImageAssetIds[0];
    if (!assetId) throw new Error("The selected influencer has no reference image.");
    return {
      imageUrl: await resolveAssetUrl(ctx, assetId),
      description: influencer.personaNotes || influencer.name,
    };
  }

  const avatarId = ref as Id<"avatars">;
  const avatar = await ctx.runQuery(internal.avatars.getInternal, { avatarId });
  if (!avatar) throw new Error("The selected avatar no longer exists.");
  const assetId = avatar.referenceAssetIds[0];
  if (!assetId) throw new Error("The selected avatar has no reference image.");
  return {
    imageUrl: await resolveAssetUrl(ctx, assetId),
    description: avatar.lookNotes || avatar.name,
  };
}
