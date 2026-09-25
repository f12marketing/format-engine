import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";
import { enforceRateLimit, takeApiBudget } from "./lib/rateLimit";
import { IMAGE_SETS, imageSetById } from "./lib/imageSets";

/**
 * Image Slideshow's stock photo sets: the Images popup's "Image sets" tab.
 *
 * Shared across every client, like `galleryFaces` -- and used the same way: a
 * picked photo is copied into the client's own `assets`, pointing at the same
 * stored bytes, so a deck built on it is owner-checked and exported exactly
 * like one built on their uploads.
 *
 * Seeded once per deployment from Pexels and Pixabay (both free):
 *
 *   npx convex env set PEXELS_API_KEY <key>      # pexels.com/api
 *   npx convex env set PIXABAY_API_KEY <key>     # pixabay.com/api/docs
 *   npx convex run imageSets:seed                # every set, ~10 per source
 *   npx convex run imageSets:seed '{"sets":["gym"],"perSource":10}'
 *   npx convex run imageSets:status
 *
 * Seeding again only tops sets up -- a photo already stored (same source and
 * id) is never fetched twice.
 *
 * The popup also searches both sources live (`search`). A photo picked from
 * a search is stored the same way, under the unlisted set "search", so it is
 * downloaded once however many clients pick it.
 *
 * Kept inside both sources' API terms:
 *  - attribution: the popup links both sources wherever their photos are
 *    browsed or searched, and credits each photographer with a link to the
 *    photo's page (`source`, `photographer`, `pageUrl` below);
 *  - no hotlinking: a photo is downloaded into storage before it is used,
 *    and the sources' own URLs are only ever shown as search thumbnails;
 *  - searches are cached for 24 hours (`stockSearches`, pruned daily);
 *  - quotas: every request spends from a deployment-wide budget kept under
 *    each source's limit (takeApiBudget);
 *  - no mass downloading: a set holds at most 20 photos, and a searched
 *    photo is only stored once someone picks it.
 */

/** The set a searched-and-picked photo is filed under. Not one of IMAGE_SETS, so it is never listed. */
const SEARCH_SET = "search";

const MAX_PER_SET = 20;

// ---------------------------------------------------------------- reading

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Gated on being an admitted client: the sets are shared, not public.
    await requireClient(ctx);
    return Promise.all(
      IMAGE_SETS.map(async (s) => {
        const rows = (
          await ctx.db
            .query("stockImages")
            .withIndex("by_set", (q) => q.eq("set", s.id))
            .take(MAX_PER_SET * 2)
        ).filter((r) => !r.archived);
        const covers = await Promise.all(
          rows.slice(0, 3).map((r) => ctx.storage.getUrl(r.thumbStorageId ?? r.storageId)),
        );
        return {
          id: s.id,
          name: s.name,
          count: rows.length,
          covers: covers.filter((u): u is string => Boolean(u)),
        };
      }),
    );
  },
});

export const images = query({
  args: { set: v.string() },
  handler: async (ctx, { set }) => {
    await requireClient(ctx);
    const rows = await ctx.db
      .query("stockImages")
      .withIndex("by_set", (q) => q.eq("set", set))
      .take(MAX_PER_SET * 2);
    return Promise.all(
      rows
        .filter((r) => !r.archived)
        .map(async (r) => ({
          id: r._id,
          url: await ctx.storage.getUrl(r.storageId),
          thumbUrl: await ctx.storage.getUrl(r.thumbStorageId ?? r.storageId),
          width: r.width ?? null,
          height: r.height ?? null,
          description: r.description,
          photographer: r.photographer ?? null,
          source: r.source,
          pageUrl: r.pageUrl ?? null,
        })),
    );
  },
});

/** The set's photos as the writer sees them: an id and what each one shows. */
export const forSet = internalQuery({
  args: { set: v.string() },
  handler: async (ctx, { set }) => {
    const rows = await ctx.db
      .query("stockImages")
      .withIndex("by_set", (q) => q.eq("set", set))
      .take(MAX_PER_SET * 2);
    return rows.filter((r) => !r.archived).map((r) => ({ id: r._id, description: r.description }));
  },
});

// ---------------------------------------------------------------- using one

/**
 * A stock photo as one of the client's own assets. The bytes are shared, not
 * copied; and a photo they already have a row for is reused, so building
 * deck after deck on the same set doesn't fill their library with duplicates.
 */
async function adopt(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  imageId: Id<"stockImages">,
): Promise<Id<"assets">> {
  const img = await ctx.db.get(imageId);
  if (!img) throw new Error("That photo is no longer available.");
  const existing = await ctx.db
    .query("assets")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .filter((q) => q.eq(q.field("storageId"), img.storageId))
    .first();
  if (existing) return existing._id;
  return ctx.runMutation(internal.assets.record, {
    clientId,
    storageId: img.storageId,
    mimeType: img.mimeType,
    bytes: img.bytes,
    width: img.width,
    height: img.height,
  });
}

/** The editor picking a set photo (Swap Image, Add Images, Add Slide). */
export const use = mutation({
  args: { imageId: v.id("stockImages") },
  handler: async (ctx, { imageId }): Promise<{ assetId: Id<"assets">; url: string | null }> => {
    const client = await requireClient(ctx);
    const assetId = await adopt(ctx, client._id, imageId);
    const asset = await ctx.db.get(assetId);
    return { assetId, url: asset ? await ctx.storage.getUrl(asset.storageId) : null };
  },
});

/** The run's copy step, adopting every photo the writer matched to a slide. */
export const useMany = internalMutation({
  args: { clientId: v.id("clients"), imageIds: v.array(v.id("stockImages")) },
  handler: async (ctx, { clientId, imageIds }): Promise<Id<"assets">[]> => {
    const out: Id<"assets">[] = [];
    for (const id of imageIds) out.push(await adopt(ctx, clientId, id));
    return out;
  },
});

// ---------------------------------------------------------------- seeding

function key(name: "PEXELS_API_KEY" | "PIXABAY_API_KEY"): string | null {
  return (process.env[name] ?? "").trim() || null;
}

interface Candidate {
  source: "pexels" | "pixabay";
  sourceId: string;
  /** Full size, for storing. */
  downloadUrl: string;
  /** Small, for a search grid. Only ever shown, never stored. */
  thumbUrl: string;
  /** ~360px, stored alongside the photo for the popup's grids. */
  thumbDownloadUrl: string;
  width?: number;
  height?: number;
  description: string;
  photographer?: string;
  pageUrl?: string;
}

type Orientation = "portrait" | "any";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer?: string;
  src: { original: string; medium: string };
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  largeImageURL: string;
  webformatURL: string;
  imageWidth: number;
  imageHeight: number;
  user?: string;
}

function fromPexels(p: PexelsPhoto, label: string): Candidate {
  return {
    source: "pexels",
    sourceId: String(p.id),
    // Resized on the source's CDN: 1080 wide is exactly a slide's width.
    downloadUrl: `${p.src.original}?auto=compress&cs=tinysrgb&w=1080`,
    thumbUrl: p.src.medium,
    thumbDownloadUrl: `${p.src.original}?auto=compress&cs=tinysrgb&w=360`,
    width: 1080,
    height: Math.round((1080 * p.height) / p.width),
    description: (p.alt || label).slice(0, 300),
    photographer: p.photographer,
    pageUrl: p.url,
  };
}

function fromPixabay(h: PixabayHit, label: string): Candidate {
  // largeImageURL is capped at 1280 on its long side.
  const scale = Math.min(1, 1280 / Math.max(h.imageWidth, h.imageHeight));
  return {
    source: "pixabay",
    sourceId: String(h.id),
    downloadUrl: h.largeImageURL,
    thumbUrl: h.webformatURL,
    // Pixabay serves other sizes by swapping the _640 suffix.
    thumbDownloadUrl: h.webformatURL.replace(/_640(\.\w+)$/, "_340$1"),
    width: Math.round(h.imageWidth * scale),
    height: Math.round(h.imageHeight * scale),
    description: `${label}${label ? ": " : ""}${h.tags}`.slice(0, 300),
    photographer: h.user,
    pageUrl: h.pageURL,
  };
}

async function searchPexels(
  query: string,
  apiKey: string,
  opts: { perPage: number; page?: number; orientation?: Orientation; label?: string },
): Promise<Candidate[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.min(80, opts.perPage)),
    page: String(opts.page ?? 1),
  });
  if ((opts.orientation ?? "portrait") === "portrait") params.set("orientation", "portrait");
  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, { headers: { Authorization: apiKey } });
  if (res.status === 401) throw new Error("PEXELS_API_KEY was rejected.");
  if (!res.ok) throw new Error(`pexels search failed: ${res.status}`);
  const body = (await res.json()) as { photos?: PexelsPhoto[] };
  return (body.photos ?? []).map((p) => fromPexels(p, opts.label ?? query));
}

async function searchPixabay(
  query: string,
  apiKey: string,
  opts: { perPage: number; page?: number; orientation?: Orientation; colors?: string; label?: string },
): Promise<Candidate[]> {
  const params = new URLSearchParams({
    key: apiKey,
    q: query.slice(0, 100),
    image_type: "photo",
    safesearch: "true",
    per_page: String(Math.min(200, Math.max(3, opts.perPage))),
    page: String(opts.page ?? 1),
  });
  if ((opts.orientation ?? "portrait") === "portrait") params.set("orientation", "vertical");
  if (opts.colors) params.set("colors", opts.colors);
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  if (res.status === 400) {
    const text = await res.text();
    // Paging past the last result is a 400 too, and just means "no more".
    if (/out of valid range/i.test(text)) return [];
    if (/key/i.test(text)) throw new Error("PIXABAY_API_KEY was rejected.");
    throw new Error(`pixabay search failed: ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`pixabay search failed: ${res.status}`);
  const body = (await res.json()) as { hits?: PixabayHit[] };
  return (body.hits ?? []).map((h) => fromPixabay(h, opts.label ?? ""));
}

/** Two result lists as one, alternating, so neither source crowds the other out. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

// ---------------------------------------------------------------- live search

/** The client, from an action's auth -- an action has no db to hand to `requireClient`. */
async function clientIdOf(ctx: ActionCtx): Promise<Id<"clients">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
  const client = await ctx.runQuery(internal.clients.getByAuthUserId, { authUserId: identity.subject });
  if (!client) throw new Error("Not authorised. This is an invite-only tool.");
  return client._id;
}

const SEARCH_PER_SOURCE = 15;
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface SearchResult {
  /** `<source>:<id>` -- what `importPhotos` takes back. */
  key: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  description: string;
  photographer: string | null;
  source: "pexels" | "pixabay";
  /** The photo's page on its source, for the photographer credit. */
  pageUrl: string | null;
}

export const cachedSearch = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    ctx.db
      .query("stockSearches")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first(),
});

export const cacheSearch = internalMutation({
  args: { key: v.string(), results: v.any() },
  handler: async (ctx, { key, results }) => {
    const old = await ctx.db
      .query("stockSearches")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (old) await ctx.db.patch(old._id, { results, fetchedAt: Date.now() });
    else await ctx.db.insert("stockSearches", { key, results, fetchedAt: Date.now() });
  },
});

/**
 * The popup's "Search all photos" bar: both sources at once, one page at a
 * time, interleaved. Results are shown from the sources' own thumbnail URLs
 * and only stored if picked (`importPhotos`).
 */
export const search = action({
  args: { query: v.string(), page: v.optional(v.number()), portrait: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ results: SearchResult[]; more: boolean }> => {
    const clientId = await clientIdOf(ctx);
    const query = args.query.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!query) return { results: [], more: false };
    const page = Math.max(1, Math.min(20, Math.floor(args.page ?? 1)));
    const orientation: Orientation = args.portrait === false ? "any" : "portrait";

    const cacheKey = `${orientation}|${page}|${query.toLowerCase()}`;
    const cached = await ctx.runQuery(internal.imageSets.cachedSearch, { key: cacheKey });
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
      return cached.results as { results: SearchResult[]; more: boolean };
    }

    await enforceRateLimit(ctx, "stockSearch", clientId);
    if (!key("PEXELS_API_KEY") && !key("PIXABAY_API_KEY")) {
      throw new Error("Photo search isn't set up on this deployment yet.");
    }
    // Each source only while the deployment has quota left for it.
    const pexelsKey = key("PEXELS_API_KEY") && (await takeApiBudget(ctx, "pexels")) ? key("PEXELS_API_KEY") : null;
    const pixabayKey =
      key("PIXABAY_API_KEY") && (await takeApiBudget(ctx, "pixabay")) ? key("PIXABAY_API_KEY") : null;
    if (!pexelsKey && !pixabayKey) {
      throw new Error("Photo search is busy right now. Try again in a few minutes, or pick an image set.");
    }
    const opts = { perPage: SEARCH_PER_SOURCE, page, orientation, label: "" };
    const found = await Promise.allSettled([
      pexelsKey ? searchPexels(query, pexelsKey, opts) : Promise.resolve([]),
      pixabayKey ? searchPixabay(query, pixabayKey, opts) : Promise.resolve([]),
    ]);
    for (const f of found) if (f.status === "rejected") console.error(`search "${query}": ${f.reason}`);
    if (found.every((f) => f.status === "rejected")) {
      throw new Error("Photo search is unavailable right now. Try again in a minute.");
    }
    const [a, b] = found.map((f) => (f.status === "fulfilled" ? f.value : []));
    const out = {
      results: interleave(a, b).map(
        (c): SearchResult => ({
          key: `${c.source}:${c.sourceId}`,
          thumbUrl: c.thumbUrl,
          width: c.width ?? null,
          height: c.height ?? null,
          description: c.description || query,
          photographer: c.photographer ?? null,
          source: c.source,
          pageUrl: c.pageUrl ?? null,
        }),
      ),
      more: a.length === SEARCH_PER_SOURCE || b.length === SEARCH_PER_SOURCE,
    };
    await ctx.runMutation(internal.imageSets.cacheSearch, { key: cacheKey, results: out });
    return out;
  },
});

/** One photo, looked up again by id -- the server never downloads a URL the browser handed it. */
async function candidateById(ctx: ActionCtx, source: "pexels" | "pixabay", id: string): Promise<Candidate> {
  if (!/^\d{1,15}$/.test(id)) throw new Error("bad photo id");
  if (!(await takeApiBudget(ctx, source))) {
    throw new Error("Photo search is busy right now. Try again in a few minutes.");
  }
  if (source === "pexels") {
    const apiKey = key("PEXELS_API_KEY");
    if (!apiKey) throw new Error("Photo search isn't set up on this deployment yet.");
    const res = await fetch(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: apiKey } });
    if (!res.ok) throw new Error(`That photo is no longer available (${res.status}).`);
    return fromPexels((await res.json()) as PexelsPhoto, "");
  }
  const apiKey = key("PIXABAY_API_KEY");
  if (!apiKey) throw new Error("Photo search isn't set up on this deployment yet.");
  const res = await fetch(`https://pixabay.com/api/?${new URLSearchParams({ key: apiKey, id })}`);
  const hit = res.ok ? ((await res.json()) as { hits?: PixabayHit[] }).hits?.[0] : undefined;
  if (!hit) throw new Error("That photo is no longer available.");
  return fromPixabay(hit, "");
}

export const storedBySource = internalQuery({
  args: { source: v.union(v.literal("pexels"), v.literal("pixabay")), sourceId: v.string() },
  handler: async (ctx, { source, sourceId }) =>
    ctx.db
      .query("stockImages")
      .withIndex("by_source", (q) => q.eq("source", source).eq("sourceId", sourceId))
      .first(),
});

/**
 * Picked search results, as the client's own images, in the order picked.
 * Each photo is stored once for everyone (reused if a set or an earlier pick
 * already has it), then adopted like a set photo.
 */
export const importPhotos = action({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }): Promise<{ assetId: string; url: string | null }[]> => {
    const clientId = await clientIdOf(ctx);
    if (keys.length > 20) throw new Error("Pick up to 20 photos at a time.");
    await enforceRateLimit(ctx, "stockSearch", clientId);

    const stockIds = await Promise.all(
      keys.map(async (k): Promise<Id<"stockImages">> => {
        const [source, id] = k.split(":");
        if (source !== "pexels" && source !== "pixabay") throw new Error("bad photo key");
        const have = await ctx.runQuery(internal.imageSets.storedBySource, { source, sourceId: id });
        if (have) return have._id;
        return storeCandidate(ctx, await candidateById(ctx, source, id), SEARCH_SET);
      }),
    );
    const assetIds = await ctx.runMutation(internal.imageSets.useMany, { clientId, imageIds: stockIds });
    const urls = await ctx.runQuery(internal.imageSets.assetUrls, { assetIds });
    return assetIds.map((assetId, i) => ({ assetId, url: urls[i] }));
  },
});

export const assetUrls = internalQuery({
  args: { assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { assetIds }) =>
    Promise.all(
      assetIds.map(async (id) => {
        const a = await ctx.db.get(id);
        return a ? await ctx.storage.getUrl(a.storageId) : null;
      }),
    ),
});

// ---------------------------------------------------------------- seeding (continued)

/**
 * One photo into storage: the 1080-wide copy slides are made from, and a
 * ~360px thumbnail for the popup's grids. A thumbnail that fails to download
 * is not worth losing the photo over -- the grids fall back to the full copy.
 */
async function storeCandidate(ctx: ActionCtx, c: Candidate, set: string): Promise<Id<"stockImages">> {
  const res = await fetch(c.downloadUrl);
  if (!res.ok) throw new Error(`Couldn't download that photo (${res.status}).`);
  const blob = await res.blob();
  const storageId = await ctx.storage.store(blob);
  const thumbStorageId = await storeThumb(ctx, c.thumbDownloadUrl);
  return ctx.runMutation(internal.imageSets.record, {
    set,
    source: c.source,
    sourceId: c.sourceId,
    storageId,
    thumbStorageId: thumbStorageId ?? undefined,
    mimeType: blob.type.startsWith("image/") ? blob.type : "image/jpeg",
    bytes: blob.size,
    width: c.width,
    height: c.height,
    description: c.description,
    photographer: c.photographer,
    pageUrl: c.pageUrl,
  });
}

async function storeThumb(ctx: ActionCtx, url: string): Promise<Id<"_storage"> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await ctx.storage.store(await res.blob());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- thumbnails for older rows

/**
 * Gives every stored photo without a thumbnail one. Rows seeded before
 * thumbnails existed have none, so the popup was downloading full-size photos
 * for its tiles. Re-runs each set's own search to get the photos' current
 * URLs (two requests a set, not one per photo), then falls back to a lookup
 * by id for anything the search no longer returns.
 *
 *   npx convex run imageSets:backfillThumbs
 */
export const backfillThumbs = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    const sets = [...IMAGE_SETS.map((s) => s.id), SEARCH_SET];
    await Promise.all(
      sets.map((set, i) => ctx.scheduler.runAfter(i * 2000, internal.imageSets.backfillSet, { set })),
    );
    return `Adding thumbnails to ${sets.length} sets over ~${Math.ceil((sets.length * 2) / 60)} min.`;
  },
});

export const missingThumbs = internalQuery({
  args: { set: v.string() },
  handler: async (ctx, { set }) =>
    (
      await ctx.db
        .query("stockImages")
        .withIndex("by_set", (q) => q.eq("set", set))
        .collect()
    )
      .filter((r) => !r.thumbStorageId)
      .map((r) => ({ id: r._id, source: r.source, sourceId: r.sourceId })),
});

export const setThumb = internalMutation({
  args: { imageId: v.id("stockImages"), thumbStorageId: v.id("_storage") },
  handler: async (ctx, { imageId, thumbStorageId }) => {
    await ctx.db.patch(imageId, { thumbStorageId });
  },
});

export const backfillSet = internalAction({
  args: { set: v.string() },
  handler: async (ctx, { set }): Promise<void> => {
    const missing = await ctx.runQuery(internal.imageSets.missingThumbs, { set });
    if (!missing.length) return;

    const byKey = new Map<string, Candidate>();
    const s = imageSetById(set);
    if (s) {
      const pexelsKey = key("PEXELS_API_KEY");
      const pixabayKey = key("PIXABAY_API_KEY");
      const wantPexels = missing.some((m) => m.source === "pexels");
      const wantPixabay = missing.some((m) => m.source === "pixabay");
      const found = await Promise.allSettled([
        pexelsKey && wantPexels && (await takeApiBudget(ctx, "pexels"))
          ? searchPexels(s.pexels, pexelsKey, { perPage: 80, label: s.name })
          : Promise.resolve([]),
        pixabayKey && wantPixabay && (await takeApiBudget(ctx, "pixabay"))
          ? searchPixabay(s.pixabay, pixabayKey, { perPage: 200, colors: s.pixabayColors, label: s.name })
          : Promise.resolve([]),
      ]);
      for (const f of found) {
        if (f.status === "fulfilled") for (const c of f.value) byKey.set(`${c.source}:${c.sourceId}`, c);
        else console.error(`${set}: ${f.reason}`);
      }
    }

    let done = 0;
    for (const m of missing) {
      try {
        const c = byKey.get(`${m.source}:${m.sourceId}`) ?? (await candidateById(ctx, m.source, m.sourceId));
        const thumb = await storeThumb(ctx, c.thumbDownloadUrl);
        if (thumb) {
          await ctx.runMutation(internal.imageSets.setThumb, { imageId: m.id, thumbStorageId: thumb });
          done++;
        }
      } catch (e) {
        console.error(`${set}: thumb for ${m.source} ${m.sourceId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`${set}: ${done} of ${missing.length} thumbnails added`);
  },
});

// ---------------------------------------------------------------- search cache upkeep

/** Drops cached searches past their 24 hours -- a stale row is never served, only stored. Daily, from crons.ts. */
export const pruneSearchCache = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - CACHE_MS;
    const stale = (await ctx.db.query("stockSearches").take(2000)).filter((r) => r.fetchedAt < cutoff);
    for (const r of stale.slice(0, 500)) await ctx.db.delete(r._id);
    return Math.min(stale.length, 500);
  },
});

export const seed = internalAction({
  args: { sets: v.optional(v.array(v.string())), perSource: v.optional(v.number()) },
  handler: async (ctx, { sets, perSource }): Promise<string> => {
    if (!key("PEXELS_API_KEY") && !key("PIXABAY_API_KEY")) {
      throw new Error(
        "Set PEXELS_API_KEY and/or PIXABAY_API_KEY first: npx convex env set PEXELS_API_KEY <key>",
      );
    }
    const chosen = sets?.length ? IMAGE_SETS.filter((s) => sets.includes(s.id)) : IMAGE_SETS;
    if (!chosen.length) throw new Error(`No such set. Ids: ${IMAGE_SETS.map((s) => s.id).join(", ")}`);
    // Staggered: Pixabay allows 100 searches a minute and Pexels 200 an hour,
    // and each set is one search on each. Awaited: a schedule call left
    // dangling when the action returns may never be committed.
    await Promise.all(
      chosen.map((s, i) =>
        ctx.scheduler.runAfter(i * 1500, internal.imageSets.seedSet, {
          set: s.id,
          perSource: perSource ?? 10,
        }),
      ),
    );
    return `Seeding ${chosen.length} set(s) over ~${Math.ceil((chosen.length * 1.5) / 60)} min. Check with: npx convex run imageSets:status`;
  },
});

export const seedSet = internalAction({
  args: { set: v.string(), perSource: v.number() },
  handler: async (ctx, { set, perSource }): Promise<void> => {
    const s = imageSetById(set);
    if (!s) throw new Error(`unknown set ${set}`);
    const have = await ctx.runQuery(internal.imageSets.sourceKeys, { set });
    const known = new Set(have.keys);
    const room = Math.max(0, MAX_PER_SET - have.count);
    if (!room) return;
    const per = Math.min(perSource, room);

    const pexelsKey = key("PEXELS_API_KEY") && (await takeApiBudget(ctx, "pexels")) ? key("PEXELS_API_KEY") : null;
    const pixabayKey =
      key("PIXABAY_API_KEY") && (await takeApiBudget(ctx, "pixabay")) ? key("PIXABAY_API_KEY") : null;
    const found = await Promise.allSettled([
      pexelsKey ? searchPexels(s.pexels, pexelsKey, { perPage: per * 2, label: s.name }) : Promise.resolve([]),
      pixabayKey
        ? searchPixabay(s.pixabay, pixabayKey, { perPage: per * 2, colors: s.pixabayColors, label: s.name })
        : Promise.resolve([]),
    ]);
    for (const f of found) if (f.status === "rejected") console.error(`${set}: ${f.reason}`);

    // An even split between the two sources, topped up from whichever has more.
    const lists = found.map((f) =>
      f.status === "fulfilled" ? f.value.filter((c) => !known.has(`${c.source}:${c.sourceId}`)) : [],
    );
    const target = Math.min(room, per * lists.filter((l) => l.length).length || per);
    const picked: Candidate[] = [];
    for (let i = 0; picked.length < target && (i < lists[0].length || i < lists[1].length); i++) {
      for (const l of lists) if (l[i] && picked.length < target) picked.push(l[i]);
    }

    let stored = 0;
    for (const c of picked) {
      try {
        await storeCandidate(ctx, c, set);
        stored++;
      } catch (e) {
        console.error(`${set}: ${c.source} ${c.sourceId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`${set}: stored ${stored}, now ${have.count + stored}`);
  },
});

export const sourceKeys = internalQuery({
  args: { set: v.string() },
  handler: async (ctx, { set }) => {
    const rows = await ctx.db
      .query("stockImages")
      .withIndex("by_set", (q) => q.eq("set", set))
      .collect();
    return {
      keys: rows.map((r) => `${r.source}:${r.sourceId}`),
      count: rows.filter((r) => !r.archived).length,
    };
  },
});

export const record = internalMutation({
  args: {
    set: v.string(),
    source: v.union(v.literal("pexels"), v.literal("pixabay")),
    sourceId: v.string(),
    storageId: v.id("_storage"),
    thumbStorageId: v.optional(v.id("_storage")),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    description: v.string(),
    photographer: v.optional(v.string()),
    pageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"stockImages">> => {
    // The same photo can turn up under two sets' searches; it belongs to one.
    const dupe = await ctx.db
      .query("stockImages")
      .withIndex("by_source", (q) => q.eq("source", args.source).eq("sourceId", args.sourceId))
      .first();
    if (dupe) {
      await ctx.storage.delete(args.storageId);
      if (args.thumbStorageId) await ctx.storage.delete(args.thumbStorageId);
      return dupe._id;
    }
    return ctx.db.insert("stockImages", { ...args, addedAt: Date.now() });
  },
});

/** Curation: hide a photo that doesn't fit its set. `npx convex run imageSets:archive '{"imageId":"…"}'` */
export const archive = internalMutation({
  args: { imageId: v.id("stockImages") },
  handler: async (ctx, { imageId }) => {
    await ctx.db.patch(imageId, { archived: true });
  },
});

/** How full every set is. */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, number> = {};
    for (const s of IMAGE_SETS) {
      const rows = await ctx.db
        .query("stockImages")
        .withIndex("by_set", (q) => q.eq("set", s.id))
        .collect();
      out[s.id] = rows.filter((r) => !r.archived).length;
    }
    return out;
  },
});
