import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

/**
 * The house audio library.
 *
 * Shared across every client, same reasoning as `clips`: a music bed isn't
 * anyone's private asset, and one copy per client would just be N copies of
 * the same bytes. Curation happens from the CLI via `dev.ts` until there is
 * an admin surface worth building, which is exactly how the clip library
 * started.
 */

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    // Gated on being an admitted client rather than being open: the library is
    // shared, but it isn't public.
    await requireClient(ctx);

    const rows = await ctx.db
      .query("audioTemplates")
      .withIndex("by_added_at")
      .order("desc")
      .take(100);

    return Promise.all(
      rows
        // Curated tracks only: imported ones are reached through search.
        .filter((t) => !t.archived && !t.source)
        .map(async (t) => ({
          id: t._id,
          name: t.name,
          durationSec: t.durationSec,
          bytes: t.bytes,
          tags: t.tags,
          url: await ctx.storage.getUrl(t.storageId),
        })),
    );
  },
});

export const getTemplateInternal = internalQuery({
  args: { templateId: v.id("audioTemplates") },
  handler: async (ctx, { templateId }) => ctx.db.get(templateId),
});

/** Curation entry point -- called from `dev.ts`, mirroring `clips.record`. */
export const recordTemplate = internalMutation({
  args: {
    name: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    durationSec: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Id<"audioTemplates">> =>
    ctx.db.insert("audioTemplates", {
      name: args.name,
      storageId: args.storageId,
      mimeType: args.mimeType,
      bytes: args.bytes,
      durationSec: args.durationSec,
      tags: args.tags ?? [],
      addedAt: Date.now(),
    }),
});

export const archiveTemplate = internalMutation({
  args: { templateId: v.id("audioTemplates") },
  handler: async (ctx, { templateId }) => {
    await ctx.db.patch(templateId, { archived: true });
  },
});

/** An imported track by where it came from -- the dedupe behind `music.importTrack`. */
export const templateBySource = internalQuery({
  args: { source: v.string(), sourceId: v.string() },
  handler: async (ctx, { source, sourceId }) =>
    ctx.db
      .query("audioTemplates")
      .withIndex("by_source", (q) => q.eq("source", source).eq("sourceId", sourceId))
      .first(),
});

export const recordImported = internalMutation({
  args: {
    name: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    durationSec: v.optional(v.number()),
    tags: v.array(v.string()),
    source: v.string(),
    sourceId: v.string(),
    creator: v.optional(v.string()),
    license: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"audioTemplates">> => {
    // Two clients picking the same new track at once both download it; the
    // second insert finds the first's row and uses that.
    const existing = await ctx.db
      .query("audioTemplates")
      .withIndex("by_source", (q) => q.eq("source", args.source).eq("sourceId", args.sourceId))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("audioTemplates", { ...args, addedAt: Date.now() });
  },
});
