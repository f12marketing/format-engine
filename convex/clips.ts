import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * The trending clip library, P9.
 *
 * Shared across every client rather than scoped to one -- a clip scraped off
 * TikTok isn't anyone's private asset, and re-ingesting the same trend for
 * each client would just be N copies of the same bytes. Ingestion itself
 * lives in `lib/clipIngest.ts` (a "use node" file, since it downloads a video
 * into memory) and is triggered from the CLI via `dev.ts` until there's an
 * admin surface worth building for it.
 */

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("clips")
      .withIndex("by_ingested_at")
      .order("desc")
      .take(limit ?? 50);
    return Promise.all(
      rows.map(async (c) => ({
        id: c._id,
        source: c.source,
        sourceUrl: c.sourceUrl,
        creatorHandle: c.creatorHandle,
        durationSec: c.durationSec,
        width: c.width,
        height: c.height,
        hasMusic: c.hasMusic,
        tags: c.tags,
        url: await ctx.storage.getUrl(c.storageId),
      })),
    );
  },
});

export const get = query({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => {
    const clip = await ctx.db.get(clipId);
    if (!clip) return null;
    return { ...clip, url: await ctx.storage.getUrl(clip.storageId) };
  },
});

export const record = internalMutation({
  args: {
    source: v.string(),
    sourceUrl: v.string(),
    creatorHandle: v.optional(v.string()),
    storageId: v.id("_storage"),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
    hasMusic: v.optional(v.boolean()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"clips">> =>
    ctx.db.insert("clips", { ...args, ingestedAt: Date.now() }),
});
