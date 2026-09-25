import {
  defaultDesign,
  sanitizeDesign,
  type MemeLayer,
  type MemeSound,
  type WallDesign,
} from "./wallOfTextDesign";

/**
 * Green Screen Meme's design: Wall of Text's (the caption and any text boxes,
 * edited in the same studio) plus the meme itself -- where it sits, how big,
 * whether its green screen comes out, and whose sound plays.
 *
 * The text is drawn into the HTML layer the render service screenshots, like
 * every other studio. The meme is not: a GIF or clip has to move, so it is
 * composited by ffmpeg from these same fractions, under that layer.
 *
 * And what a meme is, as the config holds it: one of Klipy's (the URLs its
 * API returned, unaltered -- Klipy's rules) or one of the client's own uploads.
 */

export type { MemeLayer, MemeSound };

/** The five Klipy libraries the meme popup browses, by their API path. */
export const KLIPY_TYPES = ["gifs", "clips", "stickers", "static-memes", "emojis"] as const;
export type KlipyType = (typeof KLIPY_TYPES)[number];

/** A meme picked in the popup. */
export type MemePick =
  | {
      source: "klipy";
      type: KlipyType;
      slug: string;
      title: string;
      /** What the render composites: an MP4 for GIFs and clips, a GIF or PNG where transparency matters. */
      url: string;
      /** What the editor shows: the same media where the browser can play it. */
      previewUrl: string;
      isVideo: boolean;
      width: number;
      height: number;
      /** Klipy clips carry their own sound; GIFs and stickers never do. */
      hasSound: boolean;
      /** Found by searching for a green screen: keyed by default even when its title doesn't say so. */
      greenScreen?: boolean;
    }
  | { source: "upload"; assetId: string };

// Klipy media is only ever loaded from Klipy's own CDN, exactly as the API
// returned it. Anything else is not a Klipy URL, and the render service must
// never be handed an arbitrary one to fetch.
const KLIPY_MEDIA = /^https:\/\/static\d*\.klipy\.com\/[^\s"'<>]+$/;

export function isKlipyMediaUrl(url: unknown): url is string {
  return typeof url === "string" && url.length < 2048 && KLIPY_MEDIA.test(url);
}

/** The config's meme, re-checked: a pick is whatever the browser sent. */
export function parseMemePick(raw: unknown): MemePick | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.source === "upload") {
    return typeof r.assetId === "string" && /^[a-z0-9]{10,64}$/.test(r.assetId)
      ? { source: "upload", assetId: r.assetId }
      : null;
  }
  if (r.source !== "klipy") return null;
  if (!KLIPY_TYPES.includes(r.type as KlipyType)) return null;
  if (!isKlipyMediaUrl(r.url)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return {
    source: "klipy",
    type: r.type as KlipyType,
    slug: typeof r.slug === "string" ? r.slug.slice(0, 200) : "",
    title: typeof r.title === "string" ? r.title.slice(0, 200) : "",
    url: r.url,
    previewUrl: isKlipyMediaUrl(r.previewUrl) ? r.previewUrl : r.url,
    isVideo: Boolean(r.isVideo),
    width: n(r.width),
    height: n(r.height),
    hasSound: Boolean(r.hasSound),
    greenScreen: r.greenScreen === true || undefined,
  };
}

/** Words that mean a meme was made to be keyed. */
export const GREEN_SCREEN = /green\s*-?\s*screen|chroma|greenscreen/i;

/** Whether a meme should have its green keyed out by default: an upload, or one that says it's a green screen. */
export function looksKeyable(pick: MemePick | null): boolean {
  if (!pick) return false;
  return pick.source === "upload" || Boolean(pick.greenScreen) || GREEN_SCREEN.test(pick.title);
}

/**
 * Where a new meme sits: centred, a little below the middle -- the caption
 * above it, as in the reference memes -- and wide enough to read.
 */
export function defaultMemeLayer(opts: { keyable: boolean; sound: MemeSound }): MemeLayer {
  return { x: 0.5, y: 0.58, w: 0.86, flip: false, chroma: opts.keyable, sound: opts.sound, seconds: null };
}

/**
 * The caption's starting look: the meme-account one -- a short line in bold
 * dark type on white highlight boxes, up top, clear of the meme and of the
 * platform's own buttons along the bottom.
 */
export function memeCaptionDesign(text: string, meme: MemeLayer): WallDesign & { meme: MemeLayer } {
  return {
    ...defaultDesign(text),
    weight: 700,
    size: text.length > 80 ? 52 : 60,
    color: "#111111",
    stroke: 0,
    background: "white",
    y: 0.2,
    width: 0.88,
    meme,
  };
}

const SOUNDS: readonly MemeSound[] = ["meme", "background", "none"];

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
}

/** Shortest and longest a video over a still background runs. */
export const MEME_SECONDS = { min: 3, max: 20 } as const;

/** The meme layer, each value checked -- as sanitizeDesign does the text. */
export function sanitizeMemeLayer(raw: unknown): MemeLayer {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seconds =
    typeof m.seconds === "number" && Number.isFinite(m.seconds)
      ? Math.round(clamp(m.seconds, MEME_SECONDS.min, MEME_SECONDS.max, 6))
      : null;
  return {
    x: clamp(m.x, 0, 1, 0.5),
    y: clamp(m.y, 0, 1, 0.58),
    w: clamp(m.w, 0.1, 1.6, 0.86),
    flip: m.flip === true,
    chroma: m.chroma === true,
    sound: SOUNDS.includes(m.sound as MemeSound) ? (m.sound as MemeSound) : "meme",
    seconds,
  };
}

/** The only way a meme design reaches the renderer: the text as Wall of Text checks it, and the meme layer. */
export function sanitizeMemeDesign(raw: unknown): WallDesign & { meme: MemeLayer } {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ...sanitizeDesign(raw), overlay: null, meme: sanitizeMemeLayer(d.meme) };
}
