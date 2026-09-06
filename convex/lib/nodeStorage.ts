"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Decodes a render service's base64 files and stores them, in the ONE place
 * that needs Node's runtime rather than the default action environment.
 *
 * The default runtime caps a single action at 64MB of JS heap. Every format
 * before Video Animation decoded its render service's response with
 * `Uint8Array.from(atob(base64), c => c.charCodeAt(0))` -- a per-character
 * callback over a giant intermediate string, which stayed under that ceiling
 * only because a carousel PNG or a short Custom clip is small. A stitched
 * 15-second video crossed it on the very first real run: "JavaScript
 * execution ran out of memory (maximum memory usage: 64 MB)". `"use node"`
 * gets a real `Buffer.from(base64, "base64")` (a single native decode, not a
 * per-char JS loop) and a much higher ceiling -- but a file with this
 * directive may contain ONLY actions, never a query or mutation, so this
 * lives on its own rather than inside any pipeline file.
 */
export const storeRenderedFiles = internalAction({
  args: {
    clientId: v.id("clients"),
    jobId: v.id("jobs"),
    files: v.array(
      v.object({ name: v.string(), contentType: v.string(), base64: v.string() }),
    ),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, { clientId, jobId, files, width, height }): Promise<Id<"assets">[]> => {
    const assetIds: Id<"assets">[] = [];
    for (const file of files) {
      const buf = Buffer.from(file.base64, "base64");
      const storageId = await ctx.storage.store(
        new Blob([buf], { type: file.contentType }),
      );
      assetIds.push(
        await ctx.runMutation(internal.assets.record, {
          clientId,
          producedByJobId: jobId,
          storageId,
          mimeType: file.contentType,
          bytes: buf.byteLength,
          width,
          height,
        }),
      );
    }
    return assetIds;
  },
});
