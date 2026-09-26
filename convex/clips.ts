import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

/**
 * Rights to a trending clip. The library holds other creators' videos, and
 * reusing one in an ad needs their permission or a licence: copyright, and
 * TikTok's terms, which don't grant reuse of downloaded videos. The client
 * confirms it per clip when they pick one (`confirmRights`), and a job that
 * uses a clip without that confirmation is refused.
 */
export const CLIP_RIGHTS_ERROR =
  "Confirm you have the creator's permission (or a license) to use that trending clip in your ad.";

export const confirmRights = mutation({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }): Promise<null> => {
    const client = await requireClient(ctx);
    if (!(await ctx.db.get(clipId))) throw new Error("That clip is no longer in the library.");
    const existing = await ctx.db
      .query("clipRights")
      .withIndex("by_client_clip", (q) => q.eq("clientId", client._id).eq("clipId", clipId))
      .unique();
    if (!existing) await ctx.db.insert("clipRights", { clientId: client._id, clipId, confirmedAt: Date.now() });
    return null;
  },
});

/** The trending clips a job's config uses: "clip:<id>" refs, and older jobs' `trendingClip`. */
export function clipIdsIn(config: unknown): Id<"clips">[] {
  if (!config || typeof config !== "object") return [];
  const ids: Id<"clips">[] = [];
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (typeof value !== "string" || !value) continue;
    if (value.startsWith("clip:")) ids.push(value.slice("clip:".length) as Id<"clips">);
    else if (key === "trendingClip") ids.push(value as Id<"clips">);
  }
  return ids;
}

export async function assertClipRights(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  clipIds: Id<"clips">[],
): Promise<void> {
  for (const clipId of clipIds) {
    const row = await ctx.db
      .query("clipRights")
      .withIndex("by_client_clip", (q) => q.eq("clientId", clientId).eq("clipId", clipId))
      .unique();
    if (!row) throw new Error(CLIP_RIGHTS_ERROR);
  }
}

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
