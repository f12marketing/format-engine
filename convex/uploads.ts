import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { kindForMime } from "./assets";
import { enforceRateLimit } from "./lib/rateLimit";
import { needsLikenessConsent } from "./lib/likeness";

/**
 * Browser uploads go straight to Convex storage, not through a mutation.
 *
 * The browser POSTs the bytes to a short-lived signed URL and then tells us the
 * storage id, so a 200MB demo video never has to be base64'd into a function
 * argument. Twelve formats take an upload, so this path is worth getting right
 * once.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx); // uploading is not anonymous
    await enforceRateLimit(ctx, "generateUploadUrl", client._id);
    return ctx.storage.generateUploadUrl();
  },
});

/** Records an uploaded file as an asset once the browser reports the storage id. */
export const attach = mutation({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    /** The uploader confirmed the person in it agreed to be animated -- see lib/likeness.ts. */
    likenessConsent: v.optional(v.boolean()),
  },
  handler: async (ctx, { likenessConsent, ...args }): Promise<Id<"assets">> => {
    const client = await requireClient(ctx);
    return ctx.db.insert("assets", {
      ...args,
      clientId: client._id,
      kind: kindForMime(args.mimeType),
      ...(likenessConsent ? { likenessConsentAt: Date.now() } : {}),
    });
  },
});

/** Records likeness consent for photos already uploaded, when one is picked to be animated. */
export const confirmLikenessConsent = mutation({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { assetIds }): Promise<null> => {
    const client = await requireClient(ctx);
    for (const assetId of assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.clientId !== client._id) throw new Error("Unknown asset.");
      if (needsLikenessConsent(asset)) await ctx.db.patch(assetId, { likenessConsentAt: Date.now() });
    }
    return null;
  },
});

/** Whether any of these photos is a real person's upload still waiting on consent. */
export const likenessConsentNeeded = query({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { assetIds }): Promise<boolean> => {
    const client = await requireClient(ctx);
    for (const assetId of assetIds) {
      const asset = await ctx.db.get(assetId);
      if (asset?.clientId === client._id && needsLikenessConsent(asset)) return true;
    }
    return false;
  },
});

/** What a meme can be: an animated GIF, a still sticker, or a short clip. */
const MEME_TYPES = ["image/gif", "image/png", "image/jpeg", "video/mp4", "video/webm", "video/quicktime"];

/** `attach`, for the meme popup's upload: marked as a meme, so "My memes" offers it next time. */
export const attachMeme = mutation({
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
    if (!MEME_TYPES.includes(args.mimeType)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("A meme has to be a GIF, PNG or JPG, or an MP4, WebM or MOV clip.");
    }
    return ctx.db.insert("assets", {
      ...args,
      clientId: client._id,
      kind: kindForMime(args.mimeType),
      meme: true,
    });
  },
});
