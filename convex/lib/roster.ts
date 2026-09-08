import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * A roster reference is what `field.avatar()` actually stores: a plain
 * string naming either a P10 avatar or a trained influencer. Convex's id
 * validators don't support a union of two tables, so rather than add a
 * second field to every avatar-taking format, an influencer's value is the
 * same string tagged with a prefix -- "influencer:<id>" -- and anything
 * without that prefix is read as a bare avatar id, exactly as every existing
 * job's frozen config already has it. That keeps every job created before
 * this file existed resolving exactly as it always did.
 */
export type RosterRef = string;

export function influencerRosterRef(influencerId: Id<"influencers">): RosterRef {
  return `influencer:${influencerId}`;
}

const INFLUENCER_PREFIX = "influencer:";

interface RosterPersona {
  imageUrl: string;
  /** Folded into generation prompts the same way `avatar.lookNotes` always was. */
  description: string;
}

async function resolveAssetUrl(ctx: ActionCtx, assetId: Id<"assets">): Promise<string> {
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset) throw new Error("A reference image could not be found.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("Could not read a reference image.");
  return url;
}

/**
 * Resolves either kind of roster ref to the two things every consumer
 * actually needs: a photo (P5's lipsync driving image, or one input to a P2
 * composite) and a short description of who it is. An influencer resolves to
 * one of its own training photos, not a fresh LoRA generation -- the same
 * "one still photo" contract an avatar has always had, so nothing downstream
 * needs to know which kind of persona it got.
 */
export async function resolveRosterPersona(ctx: ActionCtx, ref: RosterRef): Promise<RosterPersona> {
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
