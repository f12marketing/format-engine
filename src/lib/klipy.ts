import type { KlipyType, MemePick } from "../../convex/lib/memeDesign";

/**
 * Klipy -- GIFs, clips, stickers, memes and AI emojis -- for the meme popup.
 *
 * Klipy's integration rules shape everything here
 * (https://docs.klipy.com, "Integration Requirements"):
 *
 *  - Requests go from the user's browser, never through our servers -- so the
 *    app key is a public NEXT_PUBLIC_ one, which is how Klipy issues it.
 *  - Media URLs are used exactly as the API returns them: nothing is rebuilt,
 *    re-hosted or copied into storage. A pick keeps those URLs.
 *  - Search and Trending results are shown in the order and composition they
 *    arrive -- no reordering, filtering or dropping here. Content filtering
 *    is Klipy's `content_filter` and the Partner Panel's job.
 *  - Klipy content gets its own tabs, never mixed with the client's uploads.
 *  - The search box says "Search KLIPY" (required), and "Powered by KLIPY"
 *    sits wherever its content is shown.
 *  - Using an item fires the Share Trigger with a stable, anonymous
 *    customer_id -- a hash, never the client's id itself.
 *
 * One exception needs Klipy's written approval (developers@klipy.com) before
 * going live: the render service fetches the picked media server-side, once,
 * to burn it into the video. Nothing of it is kept, but it is a server-side
 * load all the same.
 */

export const KLIPY_APP_KEY = process.env.NEXT_PUBLIC_KLIPY_APP_KEY ?? "";
const BASE = "https://api.klipy.com/api/v1";

/** The popup's Klipy tabs, in the order it shows them. */
export const KLIPY_TABS: { type: KlipyType; label: string; noun: string }[] = [
  { type: "gifs", label: "GIFs", noun: "GIF" },
  { type: "clips", label: "Clips", noun: "Clip" },
  { type: "stickers", label: "Stickers", noun: "Sticker" },
  { type: "static-memes", label: "Memes", noun: "Meme" },
  { type: "emojis", label: "AI Emojis", noun: "AI Emoji" },
];

/** Safe for a business's feed without being prim; Klipy's own levels are off | low | medium | high. */
const CONTENT_FILTER = "medium";
const PER_PAGE = 24;

export type KlipyItem =
  | {
      kind: "item";
      type: KlipyType;
      slug: string;
      title: string;
      /** A small rendition for the grid. */
      thumb: string;
      thumbIsVideo: boolean;
      /** A blurred placeholder Klipy sends, shown while the thumb loads. */
      blur?: string;
      pick: Extract<MemePick, { source: "klipy" }>;
    }
  /** An advert Klipy placed in the results: shown where it came, never dropped. */
  | { kind: "ad"; key: string; raw: Record<string, unknown> };

export interface KlipyPage {
  items: KlipyItem[];
  hasNext: boolean;
}

interface Rendition {
  url: string;
  width: number;
  height: number;
}

/** GIFs, stickers, memes and emojis nest renditions by size, then format. */
function rendition(file: unknown, sizes: string[], formats: string[]): (Rendition & { format: string }) | null {
  const f = (file ?? {}) as Record<string, Record<string, Partial<Rendition>> | undefined>;
  for (const size of sizes) {
    for (const format of formats) {
      const r = f[size]?.[format];
      if (r && typeof r.url === "string") {
        return { url: r.url, width: Number(r.width) || 0, height: Number(r.height) || 0, format };
      }
    }
  }
  return null;
}

/**
 * What the render composites for each library. A GIF's MP4 is the same
 * animation at a fraction of the size, and has no transparency to lose;
 * stickers and emojis do, so they stay GIF (or PNG) -- ffmpeg keys a GIF's
 * transparency, and animated WebP is the one format it can't read.
 */
const RENDER_FORMATS: Record<Exclude<KlipyType, "clips">, string[]> = {
  gifs: ["mp4", "gif", "webp"],
  stickers: ["gif", "png", "webp"],
  "static-memes": ["png", "jpg", "webp"],
  emojis: ["gif", "png", "webp"],
};

function toItem(type: KlipyType, raw: Record<string, unknown>, i: number): KlipyItem | null {
  if (raw.type === "ad") return { kind: "ad", key: `ad-${i}`, raw };
  const slug = String(raw.slug ?? "");
  const title = String(raw.title ?? "").trim();
  const blur = typeof raw.blur_preview === "string" ? raw.blur_preview : undefined;

  if (type === "clips") {
    // Clips are flat: one URL per format, sizes in file_meta.
    const file = (raw.file ?? {}) as Record<string, string | undefined>;
    const meta = (raw.file_meta ?? {}) as Record<string, { width?: number; height?: number } | undefined>;
    if (!file.mp4) return null;
    const thumb = file.webp ?? file.gif ?? file.mp4;
    return {
      kind: "item",
      type,
      slug,
      title,
      thumb,
      thumbIsVideo: thumb === file.mp4,
      blur,
      pick: {
        source: "klipy",
        type,
        slug,
        title,
        url: file.mp4,
        previewUrl: file.mp4,
        isVideo: true,
        width: Number(meta.mp4?.width) || 16,
        height: Number(meta.mp4?.height) || 9,
        hasSound: true,
      },
    };
  }

  const render = rendition(raw.file, ["hd", "md", "sm"], RENDER_FORMATS[type]);
  const thumb = rendition(raw.file, ["sm", "xs", "md", "hd"], ["webp", "gif", "png", "jpg", "mp4"]);
  if (!render || !thumb) return null;
  const isVideo = render.format === "mp4";
  return {
    kind: "item",
    type,
    slug,
    title,
    thumb: thumb.url,
    thumbIsVideo: thumb.format === "mp4",
    blur,
    pick: {
      source: "klipy",
      type,
      slug,
      title,
      url: render.url,
      previewUrl: render.url,
      isVideo,
      width: render.width || thumb.width || 1,
      height: render.height || thumb.height || 1,
      hasSound: false,
    },
  };
}

export class KlipyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function get(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  if (!KLIPY_APP_KEY) throw new KlipyError("KLIPY isn't set up yet.", 0);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}/${path}?${qs}`);
  if (res.status === 429) {
    throw new KlipyError("KLIPY's request limit is reached for now — try again in a few minutes.", 429);
  }
  if (!res.ok) throw new KlipyError(`KLIPY didn't answer (${res.status}).`, res.status);
  return res.json();
}

/** Trending with no query, Search with one -- a page of either, in Klipy's order. */
export async function klipyList(
  type: KlipyType,
  { q, page, customerId, locale }: { q?: string; page: number; customerId?: string; locale?: string },
): Promise<KlipyPage> {
  const query = q?.trim();
  const body = (await get(`${type}/${query ? "search" : "trending"}`, {
    page,
    per_page: PER_PAGE,
    q: query,
    customer_id: customerId,
    locale,
    content_filter: CONTENT_FILTER,
  })) as { data?: { data?: Record<string, unknown>[]; has_next?: boolean } };
  const rows = body.data?.data ?? [];
  return {
    items: rows.map((r, i) => toItem(type, r, (page - 1) * PER_PAGE + i)).filter((x): x is KlipyItem => x !== null),
    hasNext: Boolean(body.data?.has_next),
  };
}

/**
 * The items this user used most recently in a library -- Klipy keeps the
 * list itself, from the Share Trigger, so nothing is stored here.
 */
export async function klipyRecent(type: KlipyType, customerId: string, page: number): Promise<KlipyPage> {
  const body = (await get(`${type}/recent/${encodeURIComponent(customerId)}`, { page, per_page: PER_PAGE })) as {
    data?: { data?: Record<string, unknown>[]; has_next?: boolean };
  };
  const rows = body.data?.data ?? [];
  return {
    items: rows.map((r, i) => toItem(type, r, (page - 1) * PER_PAGE + i)).filter((x): x is KlipyItem => x !== null),
    hasNext: Boolean(body.data?.has_next),
  };
}

/** Takes one item off this user's Recently used. */
export async function klipyHideRecent(type: KlipyType, customerId: string, slug: string): Promise<void> {
  if (!KLIPY_APP_KEY) return;
  const res = await fetch(
    `${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}/${type}/recent/${encodeURIComponent(customerId)}?slug=${encodeURIComponent(slug)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new KlipyError(`KLIPY didn't answer (${res.status}).`, res.status);
}

/** Completions for a half-typed search, most likely first. */
export async function klipyAutocomplete(q: string): Promise<string[]> {
  const body = (await get(`autocomplete/${encodeURIComponent(q)}`, { limit: 6 })) as { data?: unknown[] };
  return (body.data ?? []).filter((s): s is string => typeof s === "string");
}

/** Related searches for one already run, most likely to help first. */
export async function klipySuggestions(q: string): Promise<string[]> {
  const body = (await get(`search-suggestions/${encodeURIComponent(q)}`, { limit: 10 })) as { data?: unknown[] };
  return (body.data ?? []).filter((s): s is string => typeof s === "string");
}

/** Klipy's report reasons, as its Report API names them, with how the popup words them. */
export const KLIPY_REPORT_REASONS: { value: string; label: string }[] = [
  { value: "offensive", label: "Offensive" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "misinformation", label: "Misinformation" },
  { value: "copyright", label: "Copyright" },
  { value: "illegal", label: "Illegal" },
  { value: "impersonation", label: "Impersonation" },
  { value: "broken", label: "Broken or won't play" },
  { value: "low_quality", label: "Low quality" },
  { value: "not_relevant", label: "Not relevant to the search" },
  { value: "other", label: "Something else" },
];

/** Flags an item for Klipy's moderators. */
export async function klipyReport(type: KlipyType, slug: string, reason: string, customerId?: string): Promise<void> {
  if (!KLIPY_APP_KEY) throw new KlipyError("KLIPY isn't set up yet.", 0);
  const res = await fetch(`${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}/${type}/report/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId, reason }),
  });
  if (!res.ok) throw new KlipyError(`KLIPY didn't take the report (${res.status}).`, res.status);
}

export interface KlipyCategory {
  category: string;
  query: string;
  previewUrl?: string;
}

/** A library's curated categories, shown as chips that search. */
export async function klipyCategories(type: KlipyType, locale?: string): Promise<KlipyCategory[]> {
  const body = (await get(`${type}/categories`, { locale })) as {
    data?: { categories?: { category?: string; query?: string; preview_url?: string }[] };
  };
  return (body.data?.categories ?? [])
    .filter((c) => c.category && c.query)
    .map((c) => ({ category: c.category!, query: c.query!, previewUrl: c.preview_url }));
}

/** The Share Trigger, fired when an item is used. Best effort: a failed ping never blocks the pick. */
export function klipyShare(type: KlipyType, slug: string, customerId?: string, q?: string): void {
  if (!KLIPY_APP_KEY || !slug) return;
  void fetch(`${BASE}/${encodeURIComponent(KLIPY_APP_KEY)}/${type}/share/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId, q: q?.trim() || undefined }),
  }).catch(() => {});
}

/** The viewer's country, as Klipy's `locale` wants it: "en-GB" is "gb". */
export function klipyLocale(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const region = /-([A-Za-z]{2})\b/.exec(navigator.language)?.[1];
  return region?.toLowerCase();
}

/** A stable, anonymous id for Klipy: the client id, hashed, so theirs never leaves the app. */
export async function klipyCustomerId(clientId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`format-engine:${clientId}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
