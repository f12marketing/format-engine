import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query, action } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { submitWithContentPolicyFallback } from "./lib/fal";
import { referencePortraitPrompt, REFERENCE_PORTRAIT_FALLBACK } from "./lib/facePrompt";
import { enforceRateLimit } from "./lib/rateLimit";

/**
 * P10, the avatar roster.
 *
 * `avatars.clientId` is optional in the schema on purpose: null means a
 * shared "house roster" every client can pick from, a real id scopes one to
 * a single client's own persona library. `list` returns both.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const [own, house] = await Promise.all([
      ctx.db
        .query("avatars")
        .withIndex("by_client", (q) => q.eq("clientId", client._id))
        .collect(),
      ctx.db
        .query("avatars")
        .withIndex("by_client", (q) => q.eq("clientId", undefined))
        .collect(),
    ]);
    const rows = [...own, ...house].filter((a) => !a.archived);
    return Promise.all(
      rows.map(async (a) => ({
        id: a._id,
        name: a.name,
        lookNotes: a.lookNotes,
        house: a.clientId === undefined,
        imageUrl: await resolveFirstImage(ctx, a.referenceAssetIds),
        // Exposed so a caller (the influencer training-set picker) can reuse
        // an existing avatar's photo as a training image without a second
        // asset-scoped lookup.
        referenceAssetIds: a.referenceAssetIds,
      })),
    );
  },
});

async function resolveFirstImage(
  ctx: QueryCtx,
  referenceAssetIds: Id<"assets">[],
): Promise<string | null> {
  const first = referenceAssetIds[0];
  if (!first) return null;
  const asset = await ctx.db.get(first);
  if (!asset) return null;
  return ctx.storage.getUrl(asset.storageId);
}

/** Creates an avatar from an already-uploaded reference image. */
export const create = mutation({
  args: {
    name: v.string(),
    lookNotes: v.string(),
    referenceAssetId: v.id("assets"),
  },
  handler: async (ctx, { name, lookNotes, referenceAssetId }): Promise<Id<"avatars">> => {
    const client = await requireClient(ctx);
    return ctx.db.insert("avatars", {
      clientId: client._id,
      name,
      lookNotes,
      referenceAssetIds: [referenceAssetId],
    });
  },
});

/** Row lookup, for use inside a workflow step where auth context isn't available. */
export const getInternal = internalQuery({
  args: { avatarId: v.id("avatars") },
  handler: async (ctx, { avatarId }) => ctx.db.get(avatarId),
});

export const insertRow = internalMutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    lookNotes: v.string(),
    referenceAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, args): Promise<Id<"avatars">> => ctx.db.insert("avatars", args),
});

/**
 * Generates a fresh synthetic persona from a description rather than a real
 * photo -- an "AI influencer" is meant to be synthetic, and using someone's
 * actual likeness for a lipsync avatar carries real consent implications a
 * generated one sidesteps entirely.
 */
export const generate = action({
  args: {
    name: v.string(),
    lookNotes: v.string(),
  },
  handler: async (ctx, { name, lookNotes }): Promise<Id<"avatars">> => {
    // An action gets `ctx.auth` but not `ctx.db` -- `requireClient` needs
    // both, so this is its lookup half done via `ctx.runQuery` instead.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");
    await enforceRateLimit(ctx, "generateFaceImage", client._id);

    return ctx.runAction(internal.avatars.generateForClient, {
      clientId: client._id,
      name,
      lookNotes,
    });
  },
});

/** The auth-independent half of `generate` -- also `dev.ts`'s way in for testing without a Supabase session. */
export const generateForClient = internalAction({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    lookNotes: v.string(),
  },
  handler: async (ctx, { clientId, name, lookNotes }): Promise<Id<"avatars">> => {
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: 0.05,
    });

    const buildInput = (prompt: string) => ({
      prompt,
      aspect_ratio: "3:4",
      num_images: 1,
    });
    const result = (await submitWithContentPolicyFallback(
      "fal-ai/nano-banana-2",
      buildInput,
      referencePortraitPrompt(lookNotes),
      () => REFERENCE_PORTRAIT_FALLBACK,
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no portrait image returned");

    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch generated portrait: ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));

    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      storageId,
      mimeType: "image/png",
      bytes: bytes.byteLength,
      synthetic: true,
    });

    // Not recorded in spend_ledger: every row there is scoped to a jobId, and
    // avatar creation happens outside any run -- there is no job to attach
    // it to. `assertUnderCap` above still stops a runaway sequence of these
    // before it does real damage; it just isn't reflected in the ledger's
    // per-job breakdown the way a run's own steps are. Real money either way
    // (~$0.04), which is why the cap check stays even though the record
    // doesn't.

    return ctx.runMutation(internal.avatars.insertRow, {
      clientId,
      name,
      lookNotes,
      referenceAssetIds: [assetId],
    });
  },
});
