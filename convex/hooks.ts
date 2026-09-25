import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { kindForMime } from "./assets";

/**
 * "My hooks": the opening clips of hook + demo ads a client has already
 * made, offered again by the hook popup so a hook that worked can front a
 * new demo without being paid for twice.
 *
 * Nothing new is stored for this -- a hook is an ordinary video asset with
 * `hookKind` set (see schema.ts). The formats set it when they keep the clip
 * they generated; the popup's upload sets it for a clip brought in by hand.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const rows = await ctx.db
      .query("assets")
      // "reaction" is the alphabetically first kind, so this range is every
      // hook and none of the plain videos (absent sorts before any string).
      .withIndex("by_client_hook", (q) => q.eq("clientId", client._id).gte("hookKind", "reaction"))
      .collect();
    // Newest first: the index orders by kind, not age.
    rows.sort((a, b) => b._creationTime - a._creationTime);

    return Promise.all(
      rows.slice(0, 60).map(async (a) => ({
        id: a._id,
        kind: a.hookKind!,
        line: a.hookLine ?? null,
        durationSec: a.durationSec,
        createdAt: a._creationTime,
        url: await ctx.storage.getUrl(a.storageId),
        posterUrl: a.posterStorageId ? await ctx.storage.getUrl(a.posterStorageId) : null,
      })),
    );
  },
});

/** The popup's "Upload a hook": the same record as any upload, marked as a hook. */
export const attachUpload = mutation({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"assets">> => {
    const client = await requireClient(ctx);
    if (kindForMime(args.mimeType) !== "video") throw new Error("A hook has to be a video.");
    return ctx.db.insert("assets", {
      ...args,
      clientId: client._id,
      kind: "video",
      hookKind: "upload",
    });
  },
});
