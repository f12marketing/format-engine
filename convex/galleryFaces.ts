import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";

/**
 * The curated influencer gallery.
 *
 * Shared across every client, same reasoning as `audio.ts`'s house library:
 * a stock reference photo isn't anyone's private asset, and one copy per
 * client would just be N copies of the same bytes. Curation happens from the
 * CLI via `dev.ts` until there is an admin surface worth building, exactly
 * how the audio and clip libraries started.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Gated on being an admitted client rather than being open: the gallery
    // is shared, but it isn't public.
    await requireClient(ctx);

    const rows = await ctx.db
      .query("galleryFaces")
      .withIndex("by_added_at")
      .order("desc")
      .take(100);

    return Promise.all(
      rows
        .filter((f) => !f.archived)
        .map(async (f) => ({
          id: f._id,
          width: f.width,
          height: f.height,
          url: await ctx.storage.getUrl(f.storageId),
        })),
    );
  },
});

/**
 * Copies a gallery face into the client's own assets. The shared blob is
 * reused, not re-uploaded -- a `storageId` isn't single-owner, so a second
 * `assets` row can point at the same bytes as the gallery's own row, the
 * same way a rendered clip and a job's own asset can share one file.
 */
export const useFace = mutation({
  args: { faceId: v.id("galleryFaces") },
  handler: async (ctx, { faceId }): Promise<Id<"assets">> => {
    const client = await requireClient(ctx);
    const face = await ctx.db.get(faceId);
    if (!face || face.archived) throw new Error("That face is no longer available.");

    return ctx.runMutation(internal.assets.record, {
      clientId: client._id,
      storageId: face.storageId,
      mimeType: face.mimeType,
      bytes: face.bytes,
      width: face.width,
      height: face.height,
    });
  },
});

/** Curation entry point -- called from `dev.ts`, mirroring `audio.recordTemplate`. */
export const recordFace = internalMutation({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"galleryFaces">> =>
    ctx.db.insert("galleryFaces", { ...args, addedAt: Date.now() }),
});

export const archiveFace = internalMutation({
  args: { faceId: v.id("galleryFaces") },
  handler: async (ctx, { faceId }) => {
    await ctx.db.patch(faceId, { archived: true });
  },
});
