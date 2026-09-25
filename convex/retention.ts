import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * Storage upkeep for Image Slideshow, run daily from crons.ts.
 *
 * Two things grow without bound and are cheap to make again, so both are
 * deleted after RETENTION_DAYS:
 *
 *  1. Exported slides. A finished slideshow keeps its deck, so "Edit slides
 *     again" re-exports it for free -- the JPEGs themselves are only needed
 *     until they are posted. Kept regardless of age while a draft, scheduled
 *     or publishing post still points at the job or at one of the images.
 *  2. Photos picked from the popup's photo search that nothing ever used.
 *     "Used" means referenced by any of the owner's jobs (a config or any
 *     step's output, so every format counts, not just slideshows), a pending
 *     post, their brand profile, an avatar or an influencer. A used photo is
 *     marked kept and never checked again.
 *
 * Image-set photos are never deleted: they are shared, fixed in number, and
 * the whole point of the sets.
 *
 * Preview what a run would delete without deleting anything:
 *
 *   npx convex run retention:run '{"dryRun":true}'
 *   npx convex run retention:run '{"dryRun":true,"olderThanDays":0}'   # everything, as if expired
 *
 * `olderThanDays` only ever applies to a dry run: the real cutoff is fixed.
 */
export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPORT_BATCH = 25;
const SEARCH_BATCH = 50;
const SEARCH_SET = "search";

/** The cutoff a run uses: RETENTION_DAYS, or a shorter preview window on a dry run only. */
function cutoffFor(dryRun: boolean | undefined, olderThanDays: number | undefined): number {
  const days = dryRun && olderThanDays !== undefined ? Math.max(0, olderThanDays) : RETENTION_DAYS;
  return Date.now() - days * DAY_MS;
}

type Summary = { jobs: number; assets: number; bytes: number };

/**
 * What a client still relies on outside any job's own outputs: the brand
 * profile, avatars, influencer training sets, and pending posts -- by asset
 * id, and by job id (`job:<id>`) for posts that record the job they came from.
 */
async function protectedFor(ctx: QueryCtx, clientId: Id<"clients">): Promise<Set<string>> {
  const out = new Set<string>();
  const brand = await ctx.db
    .query("brands")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .first();
  if (brand?.logoAssetId) out.add(brand.logoAssetId);
  for (const id of brand?.productShotAssetIds ?? []) out.add(id);

  const avatars = await ctx.db
    .query("avatars")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  for (const a of avatars) for (const id of a.referenceAssetIds) out.add(id);

  const influencers = await ctx.db
    .query("influencers")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  for (const i of influencers) for (const id of i.trainingImageAssetIds) out.add(id);

  for (const status of ["draft", "scheduled", "publishing"] as const) {
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_client_and_status", (q) => q.eq("clientId", clientId).eq("status", status))
      .collect();
    for (const p of posts) {
      for (const id of p.mediaAssetIds) out.add(id);
      if (p.jobId) out.add(`job:${p.jobId}`);
    }
  }
  return out;
}

export const protectedAssets = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }): Promise<string[]> => [...(await protectedFor(ctx, clientId))],
});

// ---------------------------------------------------------------- 1. exported slides

export const purgeExpiredExports = internalMutation({
  args: { dryRun: v.optional(v.boolean()), olderThanDays: v.optional(v.number()) },
  handler: async (ctx, { dryRun, olderThanDays }): Promise<Summary & { more: boolean }> => {
    const cutoff = cutoffFor(dryRun, olderThanDays);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_format_and_purge", (q) =>
        q.eq("formatId", "image-slideshow").eq("outputsPurgedAt", undefined).lt("_creationTime", cutoff),
      )
      .take(EXPORT_BATCH * 4);

    const guarded = new Map<string, Set<string>>();
    const summary: Summary = { jobs: 0, assets: 0, bytes: 0 };
    let processed = 0;
    for (const job of jobs) {
      if (processed >= EXPORT_BATCH) break;
      // Still being edited or exported: nothing final to expire yet.
      if (job.status !== "done" && job.status !== "failed" && job.status !== "cancelled") continue;
      processed++;

      let keep = guarded.get(job.clientId);
      if (!keep) {
        keep = await protectedFor(ctx, job.clientId);
        guarded.set(job.clientId, keep);
      }
      if (keep.has(`job:${job._id}`)) continue;

      const outputs = await ctx.db
        .query("assets")
        .withIndex("by_job", (q) => q.eq("producedByJobId", job._id))
        .collect();
      const expired = outputs.filter((a) => a._creationTime < cutoff && !keep.has(a._id));
      // An export newer than the cutoff means the job was saved again recently:
      // come back to it once that one has expired too.
      const fresh = outputs.some((a) => a._creationTime >= cutoff);

      summary.jobs += expired.length ? 1 : 0;
      summary.assets += expired.length;
      summary.bytes += expired.reduce((n, a) => n + a.bytes, 0);
      if (dryRun) continue;

      for (const a of expired) {
        await ctx.storage.delete(a.storageId);
        if (a.posterStorageId) await ctx.storage.delete(a.posterStorageId);
        await ctx.db.delete(a._id);
      }
      const gone = new Set<string>(expired.map((a) => a._id));
      await ctx.db.patch(job._id, {
        outputAssetIds: (job.outputAssetIds ?? []).filter((id) => !gone.has(id)),
        ...(fresh ? {} : { outputsPurgedAt: Date.now() }),
      });
    }

    const more = processed >= EXPORT_BATCH;
    if (more && !dryRun) await ctx.scheduler.runAfter(0, internal.retention.purgeExpiredExports, {});
    return { ...summary, more };
  },
});

// ---------------------------------------------------------------- 2. unused searched photos

/** Searched photos past the cutoff that haven't been found in use yet, with who holds each. */
export const searchCandidates = internalQuery({
  args: { cutoff: v.number(), limit: v.number() },
  handler: async (ctx, { cutoff, limit }) => {
    const rows = await ctx.db
      .query("stockImages")
      .withIndex("by_set_and_kept", (q) =>
        q.eq("set", SEARCH_SET).eq("keptAt", undefined).lt("_creationTime", cutoff),
      )
      .take(limit);
    return Promise.all(
      rows.map(async (r) => ({
        id: r._id,
        bytes: r.bytes,
        holders: (
          await ctx.db
            .query("assets")
            .withIndex("by_storage", (q) => q.eq("storageId", r.storageId))
            .collect()
        ).map((a) => ({ assetId: a._id as string, clientId: a.clientId })),
      })),
    );
  },
});

/**
 * One page of a client's jobs, and which of `ids` appear anywhere in them --
 * config or any step's output, whatever the format. Paged so a client with
 * thousands of jobs never exceeds what one query may read.
 */
export const jobsReferencing = internalQuery({
  args: { clientId: v.id("clients"), ids: v.array(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { clientId, ids, paginationOpts }) => {
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .paginate(paginationOpts);
    const found = new Set<string>();
    for (const job of page.page) {
      const text = JSON.stringify([job.config, job.steps.map((s) => s.output)]);
      for (const id of ids) if (text.includes(id)) found.add(id);
    }
    return { found: [...found], isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const keepSearchPhoto = internalMutation({
  args: { imageId: v.id("stockImages") },
  handler: async (ctx, { imageId }) => {
    await ctx.db.patch(imageId, { keptAt: Date.now() });
  },
});

/** Deletes a searched photo, the library rows pointing at it, and its bytes. */
export const dropSearchPhoto = internalMutation({
  args: { imageId: v.id("stockImages") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.db.get(imageId);
    if (!row || row.set !== SEARCH_SET) return;
    const holders = await ctx.db
      .query("assets")
      .withIndex("by_storage", (q) => q.eq("storageId", row.storageId))
      .collect();
    for (const a of holders) await ctx.db.delete(a._id);
    await ctx.storage.delete(row.storageId);
    if (row.thumbStorageId) await ctx.storage.delete(row.thumbStorageId);
    await ctx.db.delete(imageId);
  },
});

export const purgeUnusedSearchPhotos = internalAction({
  args: { dryRun: v.optional(v.boolean()), olderThanDays: v.optional(v.number()) },
  handler: async (
    ctx,
    { dryRun, olderThanDays },
  ): Promise<{ photos: number; bytes: number; kept: number; more: boolean }> => {
    const cutoff = cutoffFor(dryRun, olderThanDays);
    const candidates = await ctx.runQuery(internal.retention.searchCandidates, { cutoff, limit: SEARCH_BATCH });

    // Every holder's references, checked once per client for all of that client's candidates.
    const byClient = new Map<Id<"clients">, string[]>();
    for (const c of candidates) {
      for (const h of c.holders) byClient.set(h.clientId, [...(byClient.get(h.clientId) ?? []), h.assetId]);
    }
    const inUse = new Set<string>();
    for (const [clientId, ids] of byClient) {
      for (const id of await ctx.runQuery(internal.retention.protectedAssets, { clientId })) {
        if (ids.includes(id)) inUse.add(id);
      }
      let cursor: string | null = null;
      for (;;) {
        const res: { found: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
          internal.retention.jobsReferencing,
          { clientId, ids, paginationOpts: { numItems: 100, cursor } },
        );
        for (const id of res.found) inUse.add(id);
        if (res.isDone) break;
        cursor = res.continueCursor;
      }
    }

    let photos = 0;
    let bytes = 0;
    let kept = 0;
    for (const c of candidates) {
      const used = c.holders.some((h) => inUse.has(h.assetId));
      if (used) {
        kept++;
        if (!dryRun) await ctx.runMutation(internal.retention.keepSearchPhoto, { imageId: c.id });
      } else {
        photos++;
        bytes += c.bytes;
        if (!dryRun) await ctx.runMutation(internal.retention.dropSearchPhoto, { imageId: c.id });
      }
    }

    const more = candidates.length === SEARCH_BATCH;
    if (more && !dryRun) await ctx.scheduler.runAfter(0, internal.retention.purgeUnusedSearchPhotos, {});
    return { photos, bytes, kept, more };
  },
});

// ---------------------------------------------------------------- the daily run

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()), olderThanDays: v.optional(v.number()) },
  handler: async (ctx, { dryRun, olderThanDays }): Promise<string> => {
    const exportsOut = await ctx.runMutation(internal.retention.purgeExpiredExports, { dryRun, olderThanDays });
    const photosOut = await ctx.runAction(internal.retention.purgeUnusedSearchPhotos, {
      dryRun,
      olderThanDays,
    });
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    const verb = dryRun ? "Would delete" : "Deleted";
    const tail = exportsOut.more || photosOut.more ? " (first batch; the rest follow)" : "";
    return (
      `${verb} ${exportsOut.assets} exported slide(s) from ${exportsOut.jobs} slideshow(s) (${mb(exportsOut.bytes)}) ` +
      `and ${photosOut.photos} unused searched photo(s) (${mb(photosOut.bytes)}); ` +
      `${photosOut.kept} searched photo(s) found in use and kept${tail}.`
    );
  },
});
