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
/**
 * Downloads a model-hosted video and stores it as one of a job's assets.
 *
 * Slideshow's Topaz and auto-subtitle passes both answer with a URL on fal's
 * CDN rather than bytes, and both replace the job's deliverable -- so the
 * file has to come back into Convex storage or the output would point at
 * something fal expires. Here rather than in slideshow.ts for the same reason
 * as everything else in this file: an upscaled 1080p cut is exactly the size
 * that crosses the default runtime's 64MB heap ceiling, and `"use node"`
 * cannot share a module with a query or a mutation.
 */
export const storeVideoFromUrl = internalAction({
  args: {
    clientId: v.id("clients"),
    jobId: v.id("jobs"),
    url: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, { clientId, jobId, url, contentType }): Promise<Id<"assets">> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch the finished video: ${res.status}`);
    // Only a real video/* type is trusted. fal's CDN serves the subtitled cut
    // as application/octet-stream, and the assets table classifies by MIME
    // type -- anything unlisted falls through to "text" -- so trusting the
    // header stored a perfectly good video as a text file: no player, no
    // poster, and invisible to every picker that filters on kind. This
    // function only ever stores videos, so a generic type means "mp4".
    const served = res.headers.get("content-type") ?? "";
    const type = contentType ?? (served.startsWith("video/") ? served : "video/mp4");
    const buf = Buffer.from(await res.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([buf], { type }));
    return ctx.runMutation(internal.assets.record, {
      clientId,
      producedByJobId: jobId,
      storageId,
      mimeType: type,
      bytes: buf.byteLength,
    });
  },
});

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
