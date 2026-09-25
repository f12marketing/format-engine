/**
 * Wall of Text's design: what the text looks like and where it sits.
 *
 * One module for both halves of the format. The studio on the job page draws
 * its live preview from `blockStyle` / `textStyle` / `overlayStyle`, and the
 * render step builds the page the render service screenshots from
 * `wallLayerHtml` -- which calls the very same three functions. A preview and
 * a burn-in written separately drift the first time someone tweaks a line
 * height in one of them; written once, what the editor shows is what the
 * video gets.
 *
 * Every size is in pixels on a 1080x1920 frame. The studio draws that frame
 * at full size and scales it down with a CSS transform, so nothing here ever
 * converts units.
 */

export const FRAME = { width: 1080, height: 1920 } as const;

/** Longest text the studio accepts. The reference videos run 90-350 characters. */
export const MAX_TEXT_CHARS = 600;

export type TextBackground = "none" | "white" | "snapchat";
export type TextAlign = "left" | "center" | "right";

export interface WallOverlay {
  /** An `assets` id, owner-checked when the render step resolves it. */
  assetId: string;
  /** Centre of the image, as fractions of the frame. */
  x: number;
  y: number;
  /** Width as a fraction of the frame width; height follows the image. */
  w: number;
}

/**
 * One block of text and its look. The design's own fields are the main text;
 * each added text box is another of these, styled and placed on its own.
 */
export interface WallText {
  text: string;
  font: string;
  weight: number;
  /** px on the 1080-wide frame. */
  size: number;
  color: string;
  /** Outline width in px on the 1080-wide frame. 0 is no outline. */
  stroke: number;
  strokeColor: string;
  background: TextBackground;
  align: TextAlign;
  /** Centre of the text block, as fractions of the frame. */
  x: number;
  y: number;
  /** Wrap width as a fraction of the frame width. */
  width: number;
}

/** How many text boxes can be added on top of the main text. */
export const MAX_TEXT_BOXES = 4;

export interface WallDesign extends WallText {
  overlay: WallOverlay | null;
  /** Added text boxes, drawn over the main text. Missing on designs from before they existed. */
  boxes?: WallText[];
}

/** Whether there is any text to burn in: the main text or an added box. */
export function hasText(d: WallDesign): boolean {
  return Boolean(d.text.trim()) || (d.boxes ?? []).some((b) => b.text.trim());
}

/**
 * The fonts the studio offers, with the weights each one actually has.
 *
 * Google Fonts rejects a request for a weight a family lacks, so the weight
 * slider snaps to this list rather than offering 100-900 for everything --
 * Bebas Neue at "bold" would otherwise silently render at its only weight.
 * TikTok Sans leads because it is what every reference video is set in.
 */
export const WALL_FONTS: { name: string; weights: readonly number[]; variable?: boolean }[] = [
  { name: "TikTok Sans", weights: [300, 400, 500, 600, 700, 800, 900], variable: true },
  { name: "Inter", weights: [400, 500, 600, 700, 800, 900], variable: true },
  { name: "Montserrat", weights: [400, 500, 600, 700, 800, 900], variable: true },
  { name: "Poppins", weights: [400, 500, 600, 700, 800, 900] },
  { name: "Roboto", weights: [400, 500, 600, 700, 800, 900], variable: true },
  { name: "Nunito", weights: [400, 500, 600, 700, 800, 900], variable: true },
  { name: "Open Sans", weights: [400, 500, 600, 700, 800], variable: true },
  { name: "Oswald", weights: [400, 500, 600, 700], variable: true },
  { name: "Playfair Display", weights: [400, 500, 600, 700, 800, 900], variable: true },
  { name: "DM Serif Display", weights: [400] },
  { name: "Caveat", weights: [400, 500, 600, 700], variable: true },
  { name: "Permanent Marker", weights: [400] },
  { name: "Bebas Neue", weights: [400] },
  { name: "Anton", weights: [400] },
  { name: "Archivo Black", weights: [400] },
  { name: "Bangers", weights: [400] },
];

const FONT_BY_NAME = new Map(WALL_FONTS.map((f) => [f.name, f]));

/** The stylesheet URL that loads one font at every weight the studio offers for it. */
export function googleFontsHref(font: string): string {
  return fontsHref([font]);
}

/** One stylesheet URL for several fonts -- every face a design with text boxes uses. */
export function fontsHref(fonts: string[]): string {
  const families = [...new Set(fonts.map((font) => FONT_BY_NAME.get(font) ?? WALL_FONTS[0]))].map((f) => {
    const ws = f.weights;
    const axis =
      ws.length === 1
        ? ""
        : f.variable
          ? `:wght@${ws[0]}..${ws[ws.length - 1]}`
          : `:wght@${ws.join(";")}`;
    return `family=${f.name.replace(/ /g, "+")}${axis}`;
  });
  // display=block: a render must never screenshot the fallback face.
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=block`;
}

/** Every font a design draws with, main text first. */
export function designFonts(d: WallDesign): string[] {
  return [d.font, ...(d.boxes ?? []).map((b) => b.font)];
}

/** The nearest weight the font really has. */
export function snapWeight(font: string, weight: number): number {
  const ws = (FONT_BY_NAME.get(font) ?? WALL_FONTS[0]).weights;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

/**
 * The look of the reference videos: TikTok Sans at a medium weight, white
 * with a thin black outline, centred, wrapping at about 84% of the frame and
 * sitting a little above the middle -- over the chest, clear of the face and
 * of the caption and buttons the platform draws along the bottom.
 */
export function defaultDesign(text: string): WallDesign {
  return {
    text,
    font: "TikTok Sans",
    weight: 500,
    size: text.length > 220 ? 44 : text.length > 120 ? 50 : 58,
    color: "#FFFFFF",
    stroke: 3,
    strokeColor: "#000000",
    background: "none",
    align: "center",
    x: 0.5,
    y: 0.42,
    width: 0.84,
    overlay: null,
    boxes: [],
  };
}

/**
 * Video Hook & Demo's caption, in the same design so it gets the same studio:
 * the reference hooks' look -- one short line, bolder and larger than a wall
 * of text, outlined, mid-frame over the reaction.
 */
export function hookCaptionDesign(text: string): WallDesign {
  return {
    ...defaultDesign(text),
    weight: 700,
    size: text.length > 70 ? 60 : 68,
    stroke: 4,
    y: 0.45,
    width: 0.86,
  };
}

/** One-click looks: the "Colours" row. Each is a partial design laid over the current one. */
export const LOOKS: { id: string; label: string; patch: Partial<WallText> }[] = [
  {
    id: "tiktok",
    label: "Classic",
    patch: { color: "#FFFFFF", stroke: 3, strokeColor: "#000000", background: "none" },
  },
  {
    id: "highlight",
    label: "Highlight",
    patch: { color: "#111111", stroke: 0, background: "white" },
  },
  {
    id: "snap",
    label: "Snap",
    patch: { color: "#FFFFFF", stroke: 0, background: "snapchat" },
  },
  {
    id: "loud",
    label: "Loud",
    patch: { color: "#FFE14D", stroke: 6, strokeColor: "#000000", background: "none", weight: 800 },
  },
  {
    id: "ink",
    label: "Ink",
    patch: { color: "#111111", stroke: 3, strokeColor: "#FFFFFF", background: "none" },
  },
];

/** Swatches offered beside every colour picker. A brand's own palette is added in front of these. */
export const SWATCHES = [
  "#FFFFFF",
  "#111111",
  "#FFE14D",
  "#FE2C55",
  "#25F4EE",
  "#7C5CFF",
  "#2ECC71",
  "#FF8A00",
] as const;

// ---------------------------------------------------------------- validation

const HEX = /^#[0-9a-fA-F]{6}$/;
// Convex ids are lowercase alphanumerics; anything else is not an asset id.
const ASSET_ID = /^[a-z0-9]{10,64}$/;

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
}

function hex(c: unknown, fallback: string): string {
  return typeof c === "string" && HEX.test(c) ? c.toUpperCase() : fallback;
}

/**
 * The only way a design reaches the renderer.
 *
 * A design arrives from the browser as the approval's `edits`, which the
 * mutation accepts as `v.any()` -- and it ends up interpolated into a page a
 * headless Chrome loads server-side. So every value is re-derived from a
 * closed set or a strict pattern here: a "colour" that is really
 * `red;background:url(http://...)` would otherwise be a request the render
 * service makes on someone's behalf. Nothing that fails a check is an error;
 * it falls back to the default, because the worst case of a bad value should
 * be an ugly video, not a failed one.
 */
export function sanitizeDesign(raw: unknown): WallDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const o = d.overlay as Record<string, unknown> | null | undefined;
  const overlay =
    o && typeof o === "object" && typeof o.assetId === "string" && ASSET_ID.test(o.assetId)
      ? {
          assetId: o.assetId,
          x: clamp(o.x, 0, 1, 0.5),
          y: clamp(o.y, 0, 1, 0.2),
          w: clamp(o.w, 0.05, 1, 0.3),
        }
      : null;

  // Empty boxes are dropped: there is nothing of them to draw.
  const boxes = (Array.isArray(d.boxes) ? d.boxes : [])
    .slice(0, MAX_TEXT_BOXES)
    .map(sanitizeText)
    .filter((b) => b.text.trim());

  return { ...sanitizeText(d), overlay, boxes };
}

/** The main text, or one added text box, each value checked as above. */
function sanitizeText(raw: unknown): WallText {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = typeof d.text === "string" ? d.text.slice(0, MAX_TEXT_CHARS) : "";
  const base = defaultDesign(text);
  const font = typeof d.font === "string" && FONT_BY_NAME.has(d.font) ? d.font : base.font;
  return {
    text,
    font,
    weight: snapWeight(font, clamp(d.weight, 100, 900, base.weight)),
    size: Math.round(clamp(d.size, 20, 140, base.size)),
    color: hex(d.color, base.color),
    stroke: clamp(d.stroke, 0, 12, base.stroke),
    strokeColor: hex(d.strokeColor, base.strokeColor),
    background: (["none", "white", "snapchat"] as const).includes(d.background as TextBackground)
      ? (d.background as TextBackground)
      : base.background,
    align: (["left", "center", "right"] as const).includes(d.align as TextAlign)
      ? (d.align as TextAlign)
      : base.align,
    x: clamp(d.x, 0, 1, base.x),
    y: clamp(d.y, 0, 1, base.y),
    width: clamp(d.width, 0.3, 1, base.width),
  };
}

// ---------------------------------------------------------------- styles

/**
 * CSS as a camelCase record, which React takes as `style` directly and
 * `toCss` turns into a declaration list for the render page. Values are
 * strings or unitless numbers only, so both readings agree.
 */
export type Style = Record<string, string | number>;

/** The positioned box. Snapchat's bar spans the whole frame; everything else wraps at `width`. */
export function blockStyle(d: WallText): Style {
  const bar = d.background === "snapchat";
  const w = FRAME.width * (bar ? 1 : d.width);
  return {
    position: "absolute",
    left: `${bar ? 0 : FRAME.width * d.x - w / 2}px`,
    top: `${FRAME.height * d.y}px`,
    width: `${w}px`,
    transform: "translateY(-50%)",
    boxSizing: "border-box",
    ...(bar
      ? {
          background: "rgba(0, 0, 0, 0.62)",
          padding: `${Math.round(d.size * 0.4)}px ${Math.round((FRAME.width * (1 - d.width)) / 2)}px`,
        }
      : {}),
  };
}

/** The paragraph: face, size, colour, outline, alignment. */
export function textStyle(d: WallText): Style {
  return {
    margin: 0,
    fontFamily: `"${d.font}", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`,
    fontWeight: d.weight,
    fontSize: `${d.size}px`,
    // White highlight boxes need room between lines or they merge into a slab.
    lineHeight: d.background === "white" ? 1.5 : 1.22,
    color: d.color,
    textAlign: d.align,
    // The references break lines by hand -- lists, a blank line before the
    // punchline -- so a typed newline has to survive.
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    ...(d.stroke > 0
      ? {
          // The stroke is centred on the glyph edge, so it is drawn at double
          // width with the fill painted over it: an outline, not a thinner letter.
          WebkitTextStroke: `${d.stroke * 2}px ${d.strokeColor}`,
          paintOrder: "stroke fill",
        }
      : {}),
  };
}

/** The per-line span. Only the white background styles it: a rounded box behind each line, as TikTok draws it. */
export function lineStyle(d: WallText): Style {
  if (d.background !== "white") return {};
  return {
    background: "#FFFFFF",
    padding: "0.1em 0.34em",
    borderRadius: "0.24em",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };
}

/**
 * The text as lines, each drawn in its own span. With one span, a blank line
 * (the beat before a punchline) still gets the white highlight's padding and
 * shows up as an empty white chip; with a span per non-blank line it's just
 * space. Both renderers split the same way.
 */
export function textLines(text: string): string[] {
  return text.split("\n");
}

export function overlayStyle(o: WallOverlay): Style {
  return {
    position: "absolute",
    left: `${FRAME.width * o.x}px`,
    top: `${FRAME.height * o.y}px`,
    width: `${FRAME.width * o.w}px`,
    height: "auto",
    transform: "translate(-50%, -50%)",
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
 * The transparent full-frame page the render service screenshots and lays
 * over the video. Takes a design that has ALREADY been through
 * `sanitizeDesign`, and the overlay's resolved URL, which the render step
 * produces from Convex storage itself rather than accepting from the browser.
 */
export function wallLayerHtml(d: WallDesign, overlayUrl: string | null): string {
  // Escaped as attribute values: font-family carries its own double quotes.
  const attr = (s: Style) => escapeHtml(toCss(s));
  const overlay =
    d.overlay && overlayUrl
      ? `<img src="${escapeHtml(overlayUrl)}" style="${attr(overlayStyle(d.overlay))}" alt="">`
      : "";
  const block = (t: WallText) => {
    const lines = textLines(t.text)
      .map((line) => (line ? `<span style="${attr(lineStyle(t))}">${escapeHtml(line)}</span>` : ""))
      .join("\n");
    return `<div style="${attr(blockStyle(t))}"><p style="${attr(textStyle(t))}">${lines}</p></div>`;
  };
  // The main text, then each added box over it -- the order the studio stacks them in.
  const texts = [d, ...(d.boxes ?? []).filter((b) => b.text.trim())].map(block).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${escapeHtml(fontsHref(designFonts(d)))}">
<style>html,body{margin:0;padding:0;background:transparent}
.frame{position:relative;width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden}</style>
</head><body><div class="frame">${overlay}${texts}</div></body></html>`;
}
