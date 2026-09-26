/**
 * Image Slideshow's text styles: how a deck's words are voiced, how many
 * slides the story runs to, how each slide's words are split into boxes and
 * styled, and what tint the photos wear.
 *
 * They are the looks of trending photo-carousels -- the lowercase confession
 * in white highlight boxes, numbered tips over dark gym shots, rules in boxes
 * -- and each image set (lib/imageSets.ts) names the one that suits it. The
 * writer is briefed from `voice`, and `layoutSlide` turns the written words
 * into the editor's text boxes, where every one stays restylable.
 *
 * Imported by both halves -- the config page previews a style with the very
 * boxes a run would start from -- so nothing here touches Convex or React.
 */

import {
  frameOf,
  newId,
  presetOverlay,
  type Frame,
  type OverlayPreset,
  type Slide,
  type SlideDeck,
  type SlideRatio,
  type SlideText,
  type TextBackground,
} from "./imageSlideshowDesign";

/** A box's look, without its words or its place. */
export type TextRole = Pick<
  SlideText,
  "font" | "weight" | "size" | "color" | "stroke" | "strokeColor" | "background" | "bgColor" | "align" | "width"
>;

/**
 * How a slide's words become boxes.
 *
 * - paragraph:    one box. The story decks -- a single highlighted paragraph.
 * - heading-body: a numbered heading, then a line or two under it, as two
 *                 boxes. The dark "tips" decks.
 * - boxes:        a heading box, then one box per paragraph of the body.
 *                 The "rules" decks, where every thought gets its own chip.
 */
export type Layout = "paragraph" | "heading-body" | "boxes";

export interface SlideshowTemplate {
  id: string;
  name: string;
  /** One line under the name in the gallery. */
  blurb: string;
  ratio: SlideRatio;
  slideCount: number;
  layout: Layout;
  /** Vertical centre of a slide's text group, as a fraction of the frame. */
  anchor: number;
  /** The hook slide's, when it sits somewhere else. */
  hookAnchor?: number;
  hook: TextRole;
  /** The hook slide's second line (a parenthetical, a promise), when the template has one. */
  hookSub?: TextRole;
  heading: TextRole;
  body: TextRole;
  overlay: { preset: OverlayPreset; opacity: number } | null;
  /** How the writer should sound, and how each slide's words are shaped. */
  voice: string;
  /** Appended to every slide's image prompt: the kind of photo this deck is made of. */
  imageLook: string;
  /** The config page's preview: a stand-in until photos load, and words that show the voice. */
  sample: { background: string; slides: WrittenSlide[] };
}

/** What the writer returns for one slide. */
export interface WrittenSlide {
  heading: string;
  body: string;
}

const role = (r: Partial<TextRole> & Pick<TextRole, "font" | "size">): TextRole => ({
  weight: 500,
  color: "#FFFFFF",
  stroke: 0,
  strokeColor: "#000000",
  background: "none" as TextBackground,
  bgColor: "#FFFFFF",
  align: "center",
  width: 0.84,
  ...r,
});

export const SLIDESHOW_TEMPLATES: SlideshowTemplate[] = [
  {
    id: "honest-story",
    name: "Honest story",
    blurb: "Lowercase confession, white highlight, warm lifestyle photos",
    ratio: "3:4",
    slideCount: 6,
    layout: "paragraph",
    anchor: 0.3,
    hookAnchor: 0.48,
    hook: role({ font: "Poppins", weight: 600, size: 58, color: "#111111", background: "white", width: 0.78 }),
    heading: role({ font: "Poppins", weight: 600, size: 50, color: "#111111", background: "white", width: 0.84 }),
    body: role({ font: "Poppins", weight: 600, size: 48, color: "#111111", background: "white", width: 0.86 }),
    overlay: null,
    voice: `A first-person story told across the slides, like a creator being honest on TikTok.
- All lowercase. Casual punctuation. Sounds typed on a phone, never like a brand.
- Slide 1 is the hook: a confession that promises a lesson, ending with an emoji pair
  like "🦋👉" -- e.g. "posting daily didn't work for me until i stopped doing this 🦋👉".
- Then: what it used to be like (specific, a little self-deprecating), the moment it
  changed, what they do now, and a light, satisfying close.
- Each slide is ONE paragraph of 20-45 words, in "body". Leave "heading" empty.
- Specific details: numbers, times, small habits. At most one emoji per slide.`,
    imageLook:
      "candid aesthetic lifestyle photo, like an iPhone or Pinterest photo: warm natural light, soft film tones, " +
      "a cosy real-life setting, people seen from behind or not looking at the camera, no text, no watermark",
    sample: {
      background: "linear-gradient(160deg,#d9b99b 0%,#8a6a55 55%,#3e2f2a 100%)",
      slides: [
        { heading: "", body: "planning my week didn't work for me until i stopped doing this 🦋👉" },
        { heading: "", body: "i used to rewrite my to-do list 4 times a day. color-coded, perfect, and completely ignored by 11am." },
        { heading: "", body: "then one sunday i wrote just 3 things on a sticky note. did all 3 before lunch. no app, no system." },
      ],
    },
  },
  {
    id: "dark-tips",
    name: "Dark mode tips",
    blurb: "Numbered tips over moody low-light photos",
    ratio: "3:4",
    slideCount: 6,
    layout: "heading-body",
    anchor: 0.46,
    hookAnchor: 0.2,
    hook: role({ font: "Inter", weight: 500, size: 56, stroke: 1.5, strokeColor: "#000000", width: 0.72 }),
    heading: role({ font: "Inter", weight: 500, size: 68, stroke: 1.5, strokeColor: "#000000", width: 0.86 }),
    body: role({ font: "Inter", weight: 400, size: 44, stroke: 1, strokeColor: "#000000", width: 0.78 }),
    overlay: { preset: "darken", opacity: 0.35 },
    voice: `An insider list: "elite knowledge" shared casually.
- Mostly lowercase, direct, a little blunt. No hashtags.
- Slide 1 is the hook, in "heading" only: a bold promise, e.g. "elite ball knowledge for
  becoming unrecognizable in 3 months". Leave its "body" empty.
- Every other slide is one numbered tip: "heading" is "1. short tip" (2-5 words), "body"
  is one or two sentences (15-30 words) saying exactly what to do.`,
    imageLook:
      "dark, moody, low-light phone photo, desaturated and slightly grainy, shot at night or in dim light, " +
      "an object or place related to the topic, no faces, no text, no watermark",
    sample: {
      background: "linear-gradient(170deg,#3a3d42 0%,#1b1c1f 60%,#0c0c0d 100%)",
      slides: [
        { heading: "elite knowledge for becoming unrecognizable in 3 months", body: "" },
        { heading: "1. consistency always wins", body: "stick to the same program every single week. same exercises, just up the weight." },
        { heading: "2. get good rest", body: "take your recovery as seriously as you take your training." },
      ],
    },
  },
  {
    id: "rules-boxes",
    name: "Rules in boxes",
    blurb: "White boxes, one thought each, over muted desk shots",
    ratio: "9:16",
    slideCount: 5,
    layout: "boxes",
    anchor: 0.5,
    hookAnchor: 0.42,
    hook: role({ font: "TikTok Sans", weight: 500, size: 76, color: "#111111", background: "white", width: 0.86 }),
    hookSub: role({ font: "TikTok Sans", weight: 400, size: 40, stroke: 0, width: 0.62 }),
    heading: role({ font: "TikTok Sans", weight: 500, size: 56, color: "#111111", background: "white", width: 0.82 }),
    body: role({ font: "TikTok Sans", weight: 500, size: 52, color: "#111111", background: "white", width: 0.82 }),
    overlay: null,
    voice: `Counter-intuitive rules that worked, told with confidence.
- Sentence case. Short, punchy sentences.
- Slide 1 is the hook: "heading" is a curiosity headline, e.g. "Weird manager rules that
  made my team the top performers"; "body" is a small parenthetical under it, e.g.
  "(yes, your team will literally thank you for these)".
- Every other slide is one rule: "heading" is "1. Rule name" (2-5 words), "body" is 2-3 very
  short paragraphs (8-22 words each) separated by a blank line: what the rule is, why it
  works, and the result.`,
    imageLook:
      "muted, dimly lit phone photo of an everyday scene related to the topic -- a desk, a laptop, a glass of water, " +
      "a plant in window light -- shot from above or at an angle, calm and uncluttered, no faces, no text, no watermark",
    sample: {
      background: "linear-gradient(180deg,#5d6166 0%,#34373b 60%,#1d1f22 100%)",
      slides: [
        { heading: "Weird study rules that got me through finals", body: "(yes, you'll wish you knew these sooner)" },
        {
          heading: "1. Phone in another room",
          body: "Not on silent. Not face down. Another room.\n\nFocus came back in about ten minutes.",
        },
      ],
    },
  },
  {
    id: "snap-pov",
    name: "Snap POV",
    blurb: "One-line POVs on a Snapchat bar, candid phone shots",
    ratio: "9:16",
    slideCount: 5,
    layout: "paragraph",
    anchor: 0.64,
    hook: role({ font: "Inter", weight: 500, size: 50, background: "snapchat", width: 0.9 }),
    heading: role({ font: "Inter", weight: 500, size: 48, background: "snapchat", width: 0.9 }),
    body: role({ font: "Inter", weight: 500, size: 48, background: "snapchat", width: 0.9 }),
    overlay: null,
    voice: `Snapchat-caption energy: a POV the viewer lives through, one beat per slide.
- Lowercase, conversational, a little funny. Like texting a best friend.
- Slide 1 opens with "pov:" and sets the scene.
- Each slide is ONE line of 6-18 words in "body"; leave "heading" empty.
- The last slide lands a punchline or a relatable truth.`,
    imageLook:
      "candid, slightly imperfect first-person phone snapshot of an everyday moment related to the topic, " +
      "natural light, real and unposed, no text, no watermark",
    sample: {
      background: "linear-gradient(165deg,#9fb4c7 0%,#5d7389 55%,#2b3440 100%)",
      slides: [
        { heading: "", body: "pov: you finally batch-cooked on sunday like the videos said" },
        { heading: "", body: "it's wednesday and you're eating the same rice for the 5th time" },
      ],
    },
  },
  {
    id: "quiet-editorial",
    name: "Quiet editorial",
    blurb: "Serif statements over calm, airy photographs",
    ratio: "4:5",
    slideCount: 5,
    layout: "heading-body",
    anchor: 0.76,
    hook: role({ font: "Playfair Display", weight: 500, size: 76, width: 0.84 }),
    heading: role({ font: "Playfair Display", weight: 500, size: 64, width: 0.84 }),
    body: role({ font: "Inter", weight: 400, size: 36, width: 0.76 }),
    overlay: { preset: "fade-bottom", opacity: 0.85 },
    voice: `Calm, considered lessons -- a magazine pull-quote, not a hot take.
- Sentence case. Measured and warm; no slang, no emoji.
- Slide 1: "heading" is a quiet, intriguing statement (5-10 words); "body" is one line
  that promises what follows.
- Every other slide: "heading" is the lesson as a short statement (3-8 words); "body" is
  one sentence (12-24 words) that makes it concrete.`,
    imageLook:
      "calm minimal editorial photograph, soft daylight, neutral beige, cream and stone tones, generous negative space, " +
      "still life, texture or architecture related to the topic, no text, no watermark",
    sample: {
      background: "linear-gradient(170deg,#efe6da 0%,#cdbba6 50%,#7d6b5c 100%)",
      slides: [
        { heading: "Slow mornings changed my work.", body: "Five small rituals, and what each one gave back." },
        { heading: "No screens for an hour", body: "The first sixty minutes decide whose priorities the day belongs to." },
      ],
    },
  },
  {
    id: "loud-listicle",
    name: "Loud listicle",
    blurb: "Big yellow headlines, bold claims, punchy photos",
    ratio: "9:16",
    slideCount: 6,
    layout: "heading-body",
    anchor: 0.5,
    hook: role({ font: "Anton", weight: 400, size: 104, color: "#FFE14D", stroke: 5, width: 0.86 }),
    heading: role({ font: "Anton", weight: 400, size: 90, color: "#FFE14D", stroke: 5, width: 0.86 }),
    body: role({ font: "TikTok Sans", weight: 700, size: 46, stroke: 3.5, width: 0.8 }),
    overlay: { preset: "darken", opacity: 0.25 },
    voice: `A high-energy listicle that makes a bold promise and pays it off.
- Headings in CAPITALS, short and loud. Bodies in normal case, plain and useful.
- Slide 1: "heading" is the promise, e.g. "5 THINGS NOBODY TELLS YOU ABOUT RENTING";
  "body" is a short teaser line (4-10 words).
- Every other slide: "heading" is "#1 ..." style (2-5 words), "body" is one or two
  sentences (12-26 words).`,
    imageLook:
      "vivid, high-contrast, punchy photo related to the topic, bold colors, dynamic angle, sharp focus, " +
      "no text, no watermark",
    sample: {
      background: "linear-gradient(160deg,#ff7a3d 0%,#c2185b 55%,#3a0d2e 100%)",
      slides: [
        { heading: "5 THINGS NOBODY TELLS YOU ABOUT RENTING", body: "number 3 cost me a deposit" },
        { heading: "#1 PHOTOS ON DAY ONE", body: "Film every wall and floor before you unpack a single box." },
      ],
    },
  },
];

export const DEFAULT_SLIDESHOW_TEMPLATE = "honest-story";

export function templateById(id: unknown): SlideshowTemplate {
  return (
    SLIDESHOW_TEMPLATES.find((t) => t.id === id) ??
    SLIDESHOW_TEMPLATES.find((t) => t.id === DEFAULT_SLIDESHOW_TEMPLATE)!
  );
}

// ---------------------------------------------------------------- layout

/**
 * Roughly how tall a box will be, in px. Only the starting layout uses this --
 * the editor measures nothing, and the client drags from wherever it lands --
 * so an average glyph width is close enough to stack boxes without overlap.
 */
function estimateHeight(text: string, r: TextRole, frame: Frame): number {
  const boxWidth = frame.width * r.width;
  const perLine = Math.max(8, Math.floor(boxWidth / (r.size * 0.54)));
  const lines = text
    .split("\n")
    .reduce((n, para) => n + Math.max(1, Math.ceil([...para].length / perLine)), 0);
  const lineHeight = r.background === "white" || r.background === "color" ? 1.32 : 1.22;
  const pad = r.background === "snapchat" ? r.size * 0.68 : r.background === "none" ? 0 : r.size * 0.24;
  return lines * r.size * lineHeight + pad;
}

function box(text: string, r: TextRole): Omit<SlideText, "y"> {
  return { id: newId("t"), text, x: 0.5, ...r };
}

/**
 * A written slide as text boxes, stacked around the template's anchor with a
 * gap that reads as "same thought" inside a group and "next thought" between.
 */
export function layoutSlide(
  t: SlideshowTemplate,
  written: WrittenSlide,
  isHook: boolean,
  frame: Frame = frameOf(t.ratio),
): SlideText[] {
  const heading = written.heading.trim();
  const body = written.body.trim();
  const items: { text: string; role: TextRole }[] = [];

  if (t.layout === "paragraph") {
    const text = [heading, body].filter(Boolean).join("\n");
    if (text) items.push({ text, role: isHook ? t.hook : t.body });
  } else if (isHook) {
    if (heading) items.push({ text: heading, role: t.hook });
    if (body) items.push({ text: body, role: t.hookSub ?? t.body });
  } else {
    if (heading) items.push({ text: heading, role: t.heading });
    if (body) {
      const paras = t.layout === "boxes" ? body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [body];
      for (const p of paras) items.push({ text: p, role: t.body });
    }
  }
  if (!items.length) return [];

  const heights = items.map((i) => estimateHeight(i.text, i.role, frame));
  const gaps = items.slice(1).map((it, i) =>
    t.layout === "boxes" ? it.role.size * 0.7 : items[i].role === it.role ? it.role.size * 0.4 : it.role.size * 1.1,
  );
  const total = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const anchor = (isHook ? (t.hookAnchor ?? t.anchor) : t.anchor) * frame.height;
  // Keep the group on the frame even when a long paragraph would push it off.
  let top = Math.min(Math.max(anchor - total / 2, frame.height * 0.06), frame.height * 0.94 - total);
  top = Math.max(top, frame.height * 0.04);

  return items.map((it, i) => {
    const y = (top + heights[i] / 2) / frame.height;
    top += heights[i] + (gaps[i] ?? 0);
    return { ...box(it.text, it.role), y: Math.min(0.97, Math.max(0.03, y)) };
  });
}

/**
 * An existing slide in another style: every box takes the look of the role it
 * plays (hook, heading or body) and keeps its words and place, and a preset
 * overlay follows the style's. An image overlay is the client's own and stays.
 * The Swap Image dialog's "use this set on every slide" calls this.
 */
export function restyleSlide(t: SlideshowTemplate, slide: Slide, isHook: boolean): Slide {
  const n = slide.texts.length;
  const roleFor = (j: number): TextRole => {
    if (t.layout === "paragraph") return isHook ? t.hook : t.body;
    if (isHook) return j === 0 ? t.hook : (t.hookSub ?? t.body);
    return j === 0 && n > 1 ? t.heading : t.body;
  };
  return {
    ...slide,
    texts: slide.texts.map((box, j) => ({ ...box, ...roleFor(j) })),
    overlay: slide.overlay?.assetId
      ? slide.overlay
      : t.overlay
        ? presetOverlay(t.overlay.preset, t.overlay.opacity)
        : null,
  };
}

/** A whole deck from what the writer wrote and the photos drawn for it. */
export function buildDeck(
  t: SlideshowTemplate,
  slides: (WrittenSlide & { imagePrompt: string; imageAssetId: string | null })[],
): SlideDeck {
  return {
    ratio: t.ratio,
    template: t.id,
    slides: slides.map(
      (s, i): Slide => ({
        id: newId("s"),
        imageAssetId: s.imageAssetId,
        imagePrompt: s.imagePrompt,
        overlay: t.overlay ? presetOverlay(t.overlay.preset, t.overlay.opacity) : null,
        pictures: [],
        texts: layoutSlide(t, s, i === 0),
      }),
    ),
  };
}
