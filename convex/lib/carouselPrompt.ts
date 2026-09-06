/**
 * The tuned carousel prompt, ported unchanged from the old app.
 *
 * This is the most valuable single artifact carried across: three eval rounds
 * over eight genres and three slide-count bands went into the budgets, the
 * role plan and the parallelism rule. Do not "improve" any of it without
 * re-running the eval harness -- every number here was measured, not guessed.
 */

/**
 * Enforced twice on purpose: stated in the prompt so the model writes to them,
 * and re-checked after the call so a violation surfaces as a visible failure
 * rather than silently overflowing a template. Every bundled template is
 * designed to hold these, which is what makes switching template after the
 * copy is written safe.
 */
export const CAROUSEL_LIMITS = {
  kicker: 24,
  headline: 60,
  body: 180,
  swipe_cue: 55,
} as const;

export const CAROUSEL_SYSTEM = `You write social media carousels -- the swipeable multi-slide posts used on
Instagram and LinkedIn. You are given source material (which may be a one-line
logline OR a complete script -- either way, distill it; never simply summarize
it slide by slide) and a slide count. Write the deck.

SLIDE ROLES:
- The exact role for every slide is listed in the prompt. Follow it precisely.
  Short decks deliberately drop "context" and "payoff" -- when there are only a
  few slides, every one of them has to carry substance rather than framing.

THE HOOK (slide 1) decides whether anything else gets read:
- Make it a bold claim, a specific number, a contrarian statement, or a sharp
  question.
- NEVER write a title card. "5 Tips for Better Sleep" is a title, not a hook.
  "You're not tired. You're under-lit." is a hook.
- No throat-clearing. No "In this post we'll explore".

EVERY SLIDE:
- One idea per slide. If your headline needs the word "and", split the slide.
- headline: at most 8 words and 60 characters. This is the slide's whole point,
  readable in a fraction of a second.
- body: at most 180 characters, and it must EARN its place -- it explains,
  proves, or sharpens the headline. If it merely restates the headline, leave
  it empty ("").
- kicker: an optional 1-3 word label above the headline ("Step 2", "The trap").
  Empty string when the slide does not need one.
- swipe_cue: at most 55 characters. A short fragment that opens a loop and makes
  the next swipe feel necessary ("But there's a catch...", "Most people stop
  here."). Required on every slide EXCEPT the final one, which must have "".

MIDDLE SLIDES ("point") must be PARALLEL. Pick one grammatical form and hold
it -- all imperatives, or all noun phrases, or all gerunds, or all "X, not Y"
contrasts. Parallelism is the single thing that makes a deck read as designed
rather than assembled.

You MAY change form once, but only where the argument itself turns -- naming
problems and then giving fixes, for instance. If you do, every slide before the
turn shares one form and every slide after shares another, so the change of
shape is doing work: it tells the reader the deck has moved on. What ruins a
deck is form drifting slide to slide for no reason. Two deliberate blocks are
good writing; five unrelated shapes are not.

THE FINAL SLIDE ("cta") asks for exactly ONE action, stated plainly. Two asks
means zero actions.

VOICE:
- Active voice. Concrete nouns. Short words.
- Cut every filler adverb (very, really, incredibly, truly, quite).
- No markdown, no asterisks, no emoji, and no hashtags anywhere in slide text.
- Do not number the slides in the text -- the template handles that.

SEPARATELY from the slides, write:
- caption: the post caption that ships alongside the carousel. 1-3 short
  paragraphs, opening with a line that stands on its own in a feed preview.
- hashtags: 5-10 relevant tags, WITHOUT the leading "#".`;

export const CAROUSEL_TOOL = {
  name: "save_carousel",
  description: "Save the generated carousel deck.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short internal name for this deck (not shown on a slide).",
      },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slide_id: { type: "string", pattern: "^slide_\\d{3}$" },
            role: {
              type: "string",
              enum: ["hook", "context", "point", "payoff", "cta"],
            },
            kicker: {
              type: "string",
              description: '1-3 word label above the headline, or "".',
            },
            headline: {
              type: "string",
              description: "At most 8 words and 60 characters.",
            },
            body: {
              type: "string",
              description:
                'At most 180 characters, or "" if the headline stands alone.',
            },
            swipe_cue: {
              type: "string",
              description:
                'Open-loop fragment, at most 55 characters. "" on the final slide only.',
            },
          },
          required: ["slide_id", "role", "kicker", "headline", "body", "swipe_cue"],
        },
      },
      caption: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
    },
    required: ["title", "slides", "caption", "hashtags"],
  },
} as const;

/**
 * The role for every slide position, as an explicit list.
 *
 * This replaced an arithmetic version that built ranges like `slides 3-N
 * "point", slide N-1 "payoff"`. That was wrong at both ends: at 5 slides it
 * spent four of them on framing around a SINGLE point slide, and at 3 and 4 it
 * emitted self-contradictory instructions -- slide 3 told to be "point" and
 * "payoff" at once. Building the list position by position makes a
 * contradiction structurally impossible.
 *
 * "context" and "payoff" are framing, not substance, so they only earn a slot
 * once the deck is long enough to afford them.
 */
export function slideRolePlan(slideCount: number): string[] {
  const head = slideCount >= 6 ? ["hook", "context"] : ["hook"];
  const tail = slideCount >= 7 ? ["payoff", "cta"] : ["cta"];
  const points = Math.max(1, slideCount - head.length - tail.length);
  return [...head, ...Array(points).fill("point"), ...tail];
}

export function carouselUserPrompt(logline: string, slideCount: number): string {
  const plan = slideRolePlan(slideCount)
    .map((role, i) => `slide ${i + 1} "${role}"`)
    .join(", ");
  return (
    `Write a carousel of exactly ${slideCount} slides.\n\n` +
    `Slide roles for this deck, in order: ${plan}.\n\n` +
    `Source material:\n\n${logline}`
  );
}

export interface CarouselSlide {
  slide_id: string;
  role: string;
  kicker: string;
  headline: string;
  body: string;
  swipe_cue: string;
}

/**
 * fal has been observed returning `slides` as a JSON *string* rather than an
 * array. The old app shipped a bug where the retry guard and the acceptance
 * guard disagreed about that, and a deck silently came back empty. One helper,
 * used by both, is the fix -- do not re-inline this check.
 */
export function carouselSlides(result: unknown): CarouselSlide[] {
  const raw = (result as { slides?: unknown } | null)?.slides;
  if (Array.isArray(raw)) return raw as CarouselSlide[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as CarouselSlide[];
    } catch {
      /* not recoverable */
    }
  }
  return [];
}
