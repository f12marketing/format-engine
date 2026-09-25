/**
 * Image Slideshow's design: every slide of the deck -- its photo, overlay,
 * pictures and text boxes -- and how each is drawn.
 *
 * The same arrangement as Wall of Text (lib/wallOfTextDesign.ts): the studio
 * on the job page draws its live preview from the style functions below, and
 * the render step builds the page the render service screenshots from
 * `slidePageHtml` -- which calls the very same functions. What the editor
 * shows is what the exported image is.
 *
 * Every size is in pixels on a frame 1080 wide; the height follows the deck's
 * ratio. Positions are fractions of the frame, so switching 3:4 to 9:16 keeps
 * every box where it was relative to the slide.
 */

import { googleFontsHref, snapWeight, WALL_FONTS } from "./wallOfTextDesign";

export { WALL_FONTS as SLIDE_FONTS, googleFontsHref, snapWeight };

// ---------------------------------------------------------------- frames

export const SLIDE_RATIOS = ["1:1", "4:5", "3:4", "9:16"] as const;
export type SlideRatio = (typeof SLIDE_RATIOS)[number];

export const FRAMES: Record<SlideRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "3:4": { width: 1080, height: 1440 },
  "9:16": { width: 1080, height: 1920 },
};

/** What each ratio is for, as the Dimensions menu labels it. */
export const RATIO_USES: Record<SlideRatio, string> = {
  "1:1": "Square post",
  "4:5": "Instagram / LinkedIn",
  "3:4": "TikTok photo mode",
  "9:16": "Stories & Reels",
};

export type Frame = { width: number; height: number };

// ---------------------------------------------------------------- the model

export const MAX_SLIDES = 20;
export const MAX_TEXTS_PER_SLIDE = 8;
export const MAX_PICTURES_PER_SLIDE = 6;
export const MAX_TEXT_CHARS = 600;
/** The editor's "Generate" tab, per client per day -- the only paid image action left in the format. */
export const GENERATED_IMAGES_PER_DAY = 20;

export type TextBackground = "none" | "white" | "snapchat" | "color";
export type TextAlign = "left" | "center" | "right";

export interface SlideText {
  id: string;
  text: string;
  font: string;
  weight: number;
  /** px on the 1080-wide frame. */
  size: number;
  color: string;
  /** Outline width in px. 0 is no outline. */
  stroke: number;
  strokeColor: string;
  background: TextBackground;
  /** The box colour when `background` is "color". */
  bgColor: string;
  align: TextAlign;
  /** Centre of the box, as fractions of the frame. */
  x: number;
  y: number;
  /** Wrap width as a fraction of the frame width. */
  width: number;
}

/** A picture laid on the slide: a screenshot, a product shot, a second photo. */
export interface SlidePicture {
  id: string;
  /** An `assets` id, owner-checked when the render step resolves it. */
  assetId: string;
  /** Centre, as fractions of the frame. */
  x: number;
  y: number;
  /** Width as a fraction of the frame width; height follows the image. */
  w: number;
  /** Corner rounding in px on the 1080-wide frame. */
  radius: number;
}

/** Built-in full-frame overlays: the tints and grain the reference decks sit under. */
export const OVERLAY_PRESETS = [
  { id: "darken", label: "Darken" },
  { id: "fade-bottom", label: "Fade up" },
  { id: "fade-top", label: "Fade down" },
  { id: "vignette", label: "Vignette" },
  { id: "grain", label: "Film grain" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
] as const;
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number]["id"];

/** One full-frame layer between the photo and everything on it: a preset, or an image of the client's. */
export interface SlideOverlay {
  preset: OverlayPreset | null;
  assetId: string | null;
  /** 0-1. */
  opacity: number;
}

export interface Slide {
  id: string;
  /** The slide's photo. Null draws a plain dark ground. */
  imageAssetId: string | null;
  /** What the photo was generated from -- the Swap Image dialog's "generate" starts here. */
  imagePrompt: string;
  overlay: SlideOverlay | null;
  pictures: SlidePicture[];
  texts: SlideText[];
}

export interface SlideDeck {
  ratio: SlideRatio;
  /** The trending template it was written to -- see imageSlideshowTemplates.ts. */
  template: string;
  slides: Slide[];
}

export function frameOf(ratio: SlideRatio): Frame {
  return FRAMES[ratio] ?? FRAMES["3:4"];
}

/** Every asset a deck draws, deduplicated -- what the editor resolves URLs for, and the render owner-checks. */
export function deckAssetIds(deck: SlideDeck): string[] {
  const ids = new Set<string>();
  for (const s of deck.slides) {
    if (s.imageAssetId) ids.add(s.imageAssetId);
    if (s.overlay?.assetId) ids.add(s.overlay.assetId);
    for (const p of s.pictures) ids.add(p.assetId);
  }
  return [...ids];
}

/** Short random ids for slides and boxes. Only ever compared, never parsed. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------- defaults

export const DEFAULT_TEXT: Omit<SlideText, "id" | "text" | "x" | "y"> = {
  font: "TikTok Sans",
  weight: 600,
  size: 52,
  color: "#111111",
  stroke: 0,
  strokeColor: "#000000",
  background: "white",
  bgColor: "#FFFFFF",
  align: "center",
  width: 0.84,
};

/** Swatches offered beside every colour picker. A brand's own palette is added in front of these. */
export const SLIDE_SWATCHES = [
  "#FFFFFF",
  "#111111",
  "#FFE14D",
  "#FE2C55",
  "#25F4EE",
  "#7C5CFF",
  "#2ECC71",
  "#FF8A00",
  "#F5EDE3",
] as const;

// ---------------------------------------------------------------- validation

const HEX = /^#[0-9a-fA-F]{6}$/;
// Convex ids are lowercase alphanumerics; anything else is not an asset id.
const ASSET_ID = /^[a-z0-9]{10,64}$/;
const LOCAL_ID = /^[a-z]{1,8}-[a-z0-9]{1,24}$/;
const FONT_NAMES = new Set(WALL_FONTS.map((f) => f.name));

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
}

function hex(c: unknown, fallback: string): string {
  return typeof c === "string" && HEX.test(c) ? c.toUpperCase() : fallback;
}

function assetId(v: unknown): string | null {
  return typeof v === "string" && ASSET_ID.test(v) ? v : null;
}

function localId(v: unknown, prefix: string): string {
  return typeof v === "string" && LOCAL_ID.test(v) ? v : newId(prefix);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function sanitizeText(raw: unknown): SlideText {
  const d = obj(raw);
  const font = typeof d.font === "string" && FONT_NAMES.has(d.font) ? d.font : DEFAULT_TEXT.font;
  const background = (["none", "white", "snapchat", "color"] as const).includes(
    d.background as TextBackground,
  )
    ? (d.background as TextBackground)
    : DEFAULT_TEXT.background;
  return {
    id: localId(d.id, "t"),
    text: typeof d.text === "string" ? d.text.slice(0, MAX_TEXT_CHARS) : "",
    font,
    weight: snapWeight(font, clamp(d.weight, 100, 900, DEFAULT_TEXT.weight)),
    size: Math.round(clamp(d.size, 16, 180, DEFAULT_TEXT.size)),
    color: hex(d.color, DEFAULT_TEXT.color),
    stroke: clamp(d.stroke, 0, 12, 0),
    strokeColor: hex(d.strokeColor, DEFAULT_TEXT.strokeColor),
    background,
    bgColor: hex(d.bgColor, DEFAULT_TEXT.bgColor),
    align: (["left", "center", "right"] as const).includes(d.align as TextAlign)
      ? (d.align as TextAlign)
      : DEFAULT_TEXT.align,
    x: clamp(d.x, 0, 1, 0.5),
    y: clamp(d.y, 0, 1, 0.5),
    width: clamp(d.width, 0.2, 1, DEFAULT_TEXT.width),
  };
}

function sanitizePicture(raw: unknown): SlidePicture | null {
  const d = obj(raw);
  const id = assetId(d.assetId);
  if (!id) return null;
  return {
    id: localId(d.id, "p"),
    assetId: id,
    x: clamp(d.x, 0, 1, 0.5),
    y: clamp(d.y, 0, 1, 0.5),
    w: clamp(d.w, 0.05, 1, 0.5),
    radius: Math.round(clamp(d.radius, 0, 120, 24)),
  };
}

function sanitizeOverlay(raw: unknown): SlideOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const d = obj(raw);
  const preset = OVERLAY_PRESETS.some((p) => p.id === d.preset) ? (d.preset as OverlayPreset) : null;
  const image = assetId(d.assetId);
  if (!preset && !image) return null;
  return { preset: image ? null : preset, assetId: image, opacity: clamp(d.opacity, 0, 1, 0.6) };
}

function sanitizeSlide(raw: unknown): Slide {
  const d = obj(raw);
  return {
    id: localId(d.id, "s"),
    imageAssetId: assetId(d.imageAssetId),
    imagePrompt: typeof d.imagePrompt === "string" ? d.imagePrompt.slice(0, 1200) : "",
    overlay: sanitizeOverlay(d.overlay),
    pictures: (Array.isArray(d.pictures) ? d.pictures : [])
      .map(sanitizePicture)
      .filter((p): p is SlidePicture => p !== null)
      .slice(0, MAX_PICTURES_PER_SLIDE),
    texts: (Array.isArray(d.texts) ? d.texts : []).slice(0, MAX_TEXTS_PER_SLIDE).map(sanitizeText),
  };
}

/**
 * The only way a deck reaches the renderer.
 *
 * It arrives from the browser as the approval's `edits` (`v.any()`) and ends
 * up interpolated into a page a headless Chrome loads server-side, so every
 * value is re-derived from a closed set or a strict pattern -- a "colour" of
 * `red;background:url(http://...)` would otherwise be a request the render
 * service makes on someone's behalf. A bad value falls back to a default:
 * the worst case should be an ugly slide, not a failed export.
 */
export function sanitizeDeck(raw: unknown): SlideDeck {
  const d = obj(raw);
  return {
    ratio: SLIDE_RATIOS.includes(d.ratio as SlideRatio) ? (d.ratio as SlideRatio) : "3:4",
    template: typeof d.template === "string" ? d.template.slice(0, 40) : "",
    slides: (Array.isArray(d.slides) ? d.slides : []).slice(0, MAX_SLIDES).map(sanitizeSlide),
  };
}

// ---------------------------------------------------------------- styles

/**
 * CSS as a camelCase record, which React takes as `style` directly and
 * `toCss` turns into a declaration list for the render page.
 */
export type Style = Record<string, string | number>;

const EMOJI_FALLBACK = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** Line height per background: highlight boxes sit close enough to merge into one shape, as TikTok draws them. */
function lineHeightOf(t: SlideText): number {
  return t.background === "white" || t.background === "color" ? 1.32 : 1.22;
}

/** The positioned box. Snapchat's bar spans the whole frame; everything else wraps at `width`. */
export function textBlockStyle(t: SlideText, frame: Frame): Style {
  const bar = t.background === "snapchat";
  const w = frame.width * (bar ? 1 : t.width);
  return {
    position: "absolute",
    left: `${bar ? 0 : frame.width * t.x - w / 2}px`,
    top: `${frame.height * t.y}px`,
    width: `${w}px`,
    transform: "translateY(-50%)",
    boxSizing: "border-box",
    ...(bar
      ? {
          background: "rgba(0, 0, 0, 0.6)",
          padding: `${Math.round(t.size * 0.34)}px ${Math.round((frame.width * (1 - t.width)) / 2)}px`,
        }
      : {}),
  };
}

/** The paragraph: face, size, colour, outline, alignment. */
export function textStyle(t: SlideText): Style {
  return {
    margin: 0,
    fontFamily: `"${t.font}", ${EMOJI_FALLBACK}`,
    fontWeight: t.weight,
    fontSize: `${t.size}px`,
    lineHeight: lineHeightOf(t),
    color: t.color,
    textAlign: t.align,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    ...(t.stroke > 0
      ? {
          // Drawn at double width with the fill painted over it: an outline,
          // not a thinner letter.
          WebkitTextStroke: `${t.stroke * 2}px ${t.strokeColor}`,
          paintOrder: "stroke fill",
        }
      : {}),
  };
}

/** The per-line span. Highlight backgrounds give each line its own rounded box. */
export function lineStyle(t: SlideText): Style {
  if (t.background !== "white" && t.background !== "color") return {};
  return {
    background: t.background === "white" ? "#FFFFFF" : t.bgColor,
    padding: "0.12em 0.38em",
    borderRadius: "0.26em",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };
}

/** Lines, each drawn in its own span, so a blank line is space rather than an empty chip. */
export function textLines(text: string): string[] {
  return text.split("\n");
}

export function pictureStyle(p: SlidePicture, frame: Frame): Style {
  return {
    position: "absolute",
    left: `${frame.width * p.x}px`,
    top: `${frame.height * p.y}px`,
    width: `${frame.width * p.w}px`,
    height: "auto",
    transform: "translate(-50%, -50%)",
    borderRadius: `${p.radius}px`,
    overflow: "hidden",
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
  };
}

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/>" +
  "<feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** A preset overlay, as the full-frame layer's own style. */
export function presetStyle(preset: OverlayPreset): Style {
  switch (preset) {
    case "darken":
      return { background: "rgba(0, 0, 0, 0.55)" };
    case "fade-bottom":
      return { background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0) 75%)" };
    case "fade-top":
      return { background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0) 70%)" };
    case "vignette":
      return { background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)" };
    case "grain":
      return { backgroundImage: GRAIN, backgroundSize: "240px 240px", mixBlendMode: "overlay" };
    case "warm":
      return { background: "#FF8A3D", mixBlendMode: "soft-light" };
    case "cool":
      return { background: "#3D7BFF", mixBlendMode: "soft-light" };
  }
}

export function overlayLayerStyle(o: SlideOverlay): Style {
  return {
    position: "absolute",
    inset: 0,
    opacity: o.opacity,
    ...(o.preset && !o.assetId ? presetStyle(o.preset) : {}),
  };
}

/** A camelCase style record as CSS declarations. `WebkitX` becomes `-webkit-x`. */
export function toCss(style: Style): string {
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(";");
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * One slide as the page the render service screenshots. Takes a deck that
 * has ALREADY been through `sanitizeDeck`, and asset URLs the render step
 * resolved from Convex storage itself -- an id with no URL (not the client's,
 * or gone) is simply left out.
 */
export function slidePageHtml(
  deck: SlideDeck,
  slide: Slide,
  urls: Record<string, string>,
): string {
  const frame = frameOf(deck.ratio);
  const attr = (s: Style) => escapeHtml(toCss(s));
  const url = (id: string | null) => (id ? urls[id] : undefined);

  const photo = url(slide.imageAssetId);
  const background = photo
    ? `<img src="${escapeHtml(photo)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" alt="">`
    : "";

  let overlay = "";
  if (slide.overlay) {
    const img = url(slide.overlay.assetId);
    if (img) {
      overlay = `<img src="${escapeHtml(img)}" style="${attr({
        ...overlayLayerStyle(slide.overlay),
        width: "100%",
        height: "100%",
        objectFit: "cover",
      })}" alt="">`;
    } else if (slide.overlay.preset) {
      overlay = `<div style="${attr(overlayLayerStyle(slide.overlay))}"></div>`;
    }
  }

  const pictures = slide.pictures
    .map((p) => {
      const src = url(p.assetId);
      return src
        ? `<div style="${attr(pictureStyle(p, frame))}"><img src="${escapeHtml(src)}" style="display:block;width:100%;height:auto" alt=""></div>`
        : "";
    })
    .join("");

  const texts = slide.texts
    .filter((t) => t.text.trim())
    .map((t) => {
      const lines = textLines(t.text)
        .map((line) => (line ? `<span style="${attr(lineStyle(t))}">${escapeHtml(line)}</span>` : ""))
        .join("\n");
      return `<div style="${attr(textBlockStyle(t, frame))}"><p style="${attr(textStyle(t))}">${lines}</p></div>`;
    })
    .join("");

  const fonts = [...new Set(slide.texts.map((t) => t.font))]
    .map((f) => `<link rel="stylesheet" href="${escapeHtml(googleFontsHref(f))}">`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8">${fonts}
<style>html,body{margin:0;padding:0;background:#111}
.frame{position:relative;width:${frame.width}px;height:${frame.height}px;overflow:hidden;background:#111}</style>
</head><body><div class="frame">${background}${overlay}${pictures}${texts}</div></body></html>`;
}
