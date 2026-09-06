import type {
  ChoiceField,
  CountField,
  Field,
  SecondsField,
  SimpleField,
  TextField,
} from "./types";

/**
 * The thirteen recurring field types.
 *
 * The updated spec is ~70 field slots across the fourteen new formats, drawn
 * from these thirteen. Get them right once and a config panel is a
 * declaration; get them wrong and it's fourteen screens.
 */

/** Classic | Outline | Yellow Pop | Comic | Headline -- five formats use it. */
export const CAPTION_STYLES = [
  "Classic",
  "Outline",
  "Yellow Pop",
  "Comic",
  "Headline",
] as const;

/** English in the UI; the TTS layer underneath is already multilingual. */
export const LANGUAGES = [{ code: "en", label: "English" }] as const;

export const field = {
  shortText: (o: Omit<TextField, "kind">): TextField => ({ kind: "shortText", ...o }),
  longText: (o: Omit<TextField, "kind">): TextField => ({ kind: "longText", ...o }),

  choice: (o: Omit<ChoiceField, "kind">): ChoiceField => ({ kind: "choice", ...o }),

  toggle: (o: Omit<SimpleField, "kind">): SimpleField => ({ kind: "toggle", ...o }),

  seconds: (o: Omit<SecondsField, "kind" | "min"> & { min?: number }): SecondsField => ({
    kind: "seconds",
    min: 0,
    ...o,
  }),

  count: (o: Omit<CountField, "kind">): CountField => ({ kind: "count", ...o }),

  image: (o: Omit<SimpleField, "kind">): SimpleField => ({ kind: "image", ...o }),
  video: (o: Omit<SimpleField, "kind">): SimpleField => ({ kind: "video", ...o }),

  language: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "language",
    label: "Language",
    default: "en",
    ...o,
  }),

  captionStyle: (o?: Partial<Omit<ChoiceField, "kind" | "options">>): ChoiceField => ({
    kind: "captionStyle",
    label: "Caption style",
    options: CAPTION_STYLES,
    default: "Classic",
    ...o,
  }),

  /** P10. "Who's cutting", "Avatar" and "Presenter" are all this field. */
  avatar: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "avatar",
    label: "AI influencer",
    ...o,
  }),

  /** P9. Renders as a filterable grid over the ingested clip library. */
  trendingClip: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "trendingClip",
    label: "Trending video",
    ...o,
  }),

  /**
   * "Create new" vs "Remix existing". Present on five formats in the spec.
   * The capability is universal -- every finished job offers Remix and
   * Regenerate copy -- so this field is a shortcut into that flow from the
   * picker, not the only way to reach it.
   */
  mode: (o?: Partial<Omit<ChoiceField, "kind" | "options">>): ChoiceField => ({
    kind: "mode",
    label: "Mode",
    options: ["Create new", "Remix existing"],
    default: "Create new",
    ...o,
  }),

  /** "Mention your business?" -- joins the brands record into the prompt. */
  mentionBusiness: (): SimpleField => ({
    kind: "toggle",
    label: "Mention your business?",
    help: "Pulls name, tone and palette from the brand profile.",
    default: false,
  }),

  /** The optional free-text steer that sits on top of generated copy. */
  prompt: (): TextField => ({
    kind: "longText",
    label: "Prompt",
    optional: true,
    placeholder: "Anything specific you want it to say or avoid.",
  }),
} satisfies Record<string, (...args: never[]) => Field>;
