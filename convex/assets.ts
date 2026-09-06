import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

/**
 * Uploads and outputs, in one table.
 *
 * A render that only exists inside a step's output blob is not a deliverable --
 * you cannot download it, and it disappears the moment the job row is trimmed.
 * Storing bytes and recording an `assets` row is what turns "the pipeline ran"
 * into "here is your carousel".
 */

const KIND_BY_MIME: Record<string, "image" | "video" | "audio" | "pdf" | "text"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "video/mp4": "video",
  "audio/mpeg": "audio",
  "application/pdf": "pdf",
  "text/plain": "text",
};

export function kindForMime(mime: string) {
  return KIND_BY_MIME[mime] ?? "text";
}

export const record = internalMutation({
  args: {
    clientId: v.id("clients"),
    producedByJobId: v.optional(v.id("jobs")),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"assets">> =>
    ctx.db.insert("assets", { ...args, kind: kindForMime(args.mimeType) }),
});

/**
 * Signed URLs for a job's outputs.
 *
 * Scoped by client rather than by id, because an id is not an authorisation --
 * knowing a job id must not be enough to read what it produced.
 */
export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const client = await requireClient(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.clientId !== client._id) return [];

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_job", (q) => q.eq("producedByJobId", jobId))
      .collect();

    return Promise.all(
      assets.map(async (a) => ({
        id: a._id,
        kind: a.kind,
        mimeType: a.mimeType,
        bytes: a.bytes,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});
