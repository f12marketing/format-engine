import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { kindForMime } from "./assets";
import { enforceRateLimit } from "./lib/rateLimit";

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
  },
  handler: async (ctx, args): Promise<Id<"assets">> => {
    const client = await requireClient(ctx);
    return ctx.db.insert("assets", {
      ...args,
      clientId: client._id,
      kind: kindForMime(args.mimeType),
    });
  },
});
