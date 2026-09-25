import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

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
  "image/webp": "image",
  "video/mp4": "video",
  // Phones record .mov; a picker filtering on "video" must still see it.
  "video/quicktime": "video",
  "video/webm": "video",
  // The browser reports a different type per container, and anything not
  // listed here falls through to "text" -- which means the file uploads fine
  // and then never appears in a picker that filters on kind.
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/ogg": "audio",
  "audio/webm": "audio",
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
  handler: async (ctx, args): Promise<Id<"assets">> => {
    const kind = kindForMime(args.mimeType);
    const assetId = await ctx.db.insert("assets", { ...args, kind });
    // Every video-producing format already funnels through this one
    // mutation, so this is the one place a poster needs scheduling from --
    // not a call added to each format's own render step. Backgrounded
    // rather than awaited: a render-service round trip is not something
    // whatever just finished (a job, an upload) should block on.
    if (kind === "video") {
      await ctx.scheduler.runAfter(0, internal.assets.generatePoster, { assetId });
    }
    return assetId;
  },
});

export const setPoster = internalMutation({
  args: { assetId: v.id("assets"), posterStorageId: v.id("_storage") },
  handler: async (ctx, { assetId, posterStorageId }) => {
    await ctx.db.patch(assetId, { posterStorageId });
  },
});

/**
 * A still for the Library grid, so a video tile doesn't have to buffer the
 * clip itself just to show what it is. Calls render-service's `/frame/first` --
 * already built for Character Swap's "Recreate" mode (characterSwap.ts) to
 * grab a video's first frame; this is the same endpoint, same call shape,
 * for a different reason.
 *
 * Fails quietly: render-service being briefly unreachable, or a codec it
 * can't read a frame from, means a missing thumbnail, not a broken asset --
 * worth logging, not worth surfacing as a job failure or retrying.
 */
export const generatePoster = internalAction({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }): Promise<void> => {
    const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
    if (!asset) return;

    const videoUrl = await ctx.storage.getUrl(asset.storageId);
    if (!videoUrl) return;

    const res = await fetch(`${renderServiceBase()}/frame/first`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({ videoUrl }),
    });
    if (!res.ok) {
      console.error(`poster extraction failed for asset ${assetId}: ${res.status}`);
      return;
    }

    const { base64 } = (await res.json()) as { base64: string };
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const posterStorageId = await ctx.storage.store(
      new Blob([bytes as unknown as BlobPart], { type: "image/png" }),
    );
    await ctx.runMutation(internal.assets.setPoster, { assetId, posterStorageId });
  },
});

/** Reads an asset row from inside a workflow step, where auth context isn't available. */
export const getInternal = internalQuery({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => ctx.db.get(assetId),
});

/**
 * Signed URLs for a client's own assets, keyed by id -- the influencer
 * training-set picker's thumbnail grid, for assets that don't belong to a
 * job yet (generated or uploaded straight into a not-yet-created draft).
 * Scoped by ownership check per id, same reasoning as `forJob`: an id is not
 * an authorisation.
 */
export const urlsFor = query({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { assetIds }) => {
    const client = await requireClient(ctx);
    const rows = await Promise.all(assetIds.map((id) => ctx.db.get(id)));
    return Promise.all(
      rows.map(async (a, i) => {
        if (!a || a.clientId !== client._id) return null;
        return { id: assetIds[i], url: await ctx.storage.getUrl(a.storageId) };
      }),
    );
  },
});

/**
 * The client's audio clips, for the "Audio" picker on the generated-scene
 * formats. Not paginated: this is a short list feeding a compact control, and
 * a picker that needs a Load more button is the wrong control anyway.
 */
export const audioLibrary = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .order("desc")
      .filter((q) => q.eq(q.field("kind"), "audio"))
      .take(50);

    return Promise.all(
      rows.map(async (a) => ({
        id: a._id,
        bytes: a.bytes,
        durationSec: a.durationSec,
        createdAt: a._creationTime,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});

/**
 * The client's own videos or images, for a "choose from library" picker --
 * Wall of Text's background video and its overlay image. Uploads and
 * generated outputs together, newest first: a finished render is as
 * reasonable a thing to reuse as a fresh upload. Same "short list, no
 * pagination" reasoning as `audioLibrary`.
 */
export const mediaLibrary = query({
  args: { kind: v.union(v.literal("video"), v.literal("image")) },
  handler: async (ctx, { kind }) => {
    const client = await requireClient(ctx);
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .order("desc")
      .filter((q) => q.eq(q.field("kind"), kind))
      .take(60);

    return Promise.all(
      rows.map(async (a) => ({
        id: a._id,
        uploaded: a.producedByJobId === undefined,
        width: a.width,
        height: a.height,
        durationSec: a.durationSec,
        createdAt: a._creationTime,
        url: await ctx.storage.getUrl(a.storageId),
        posterUrl: a.posterStorageId ? await ctx.storage.getUrl(a.posterStorageId) : null,
      })),
    );
  },
});

/**
 * The Library's two asset tabs.
 *
 * One query rather than two, split on `producedByJobId`: "My Content" is what
 * the engine generated, "My Media Bank" is what was uploaded. They are the
 * same rows in the same table -- the presence of a job is the only difference.
 *
 * Paginated because a client running this for months has more assets than a
 * page should load, same reasoning as `jobs.history`.
 */
export const library = query({
  args: {
    paginationOpts: paginationOptsValidator,
    source: v.union(v.literal("generated"), v.literal("uploaded")),
  },
  handler: async (ctx, { paginationOpts, source }) => {
    const client = await requireClient(ctx);
    const page = await ctx.db
      .query("assets")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .order("desc")
      .filter((q) =>
        source === "generated"
          ? q.neq(q.field("producedByJobId"), undefined)
          : q.eq(q.field("producedByJobId"), undefined),
      )
      .paginate(paginationOpts);

    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (a) => ({
          id: a._id,
          kind: a.kind,
          mimeType: a.mimeType,
          bytes: a.bytes,
          width: a.width,
          height: a.height,
          durationSec: a.durationSec,
          producedByJobId: a.producedByJobId,
          createdAt: a._creationTime,
          url: await ctx.storage.getUrl(a.storageId),
          // Absent until the render service has extracted one; the grid falls
          // back to the video itself, which is heavier but always correct.
          posterUrl: a.posterStorageId ? await ctx.storage.getUrl(a.posterStorageId) : null,
        })),
      ),
    };
  },
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
        // Dimensions and duration drive the publish pre-flight: TikTok and
        // Instagram Reels are 9:16 only, and every platform caps length.
        width: a.width,
        height: a.height,
        durationSec: a.durationSec,
        url: await ctx.storage.getUrl(a.storageId),
      })),
    );
  },
});
