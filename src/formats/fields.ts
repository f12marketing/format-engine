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

/** Classic | Outline | Yellow Pop | Comic | Headline | Banner. */
export const CAPTION_STYLES = [
  "Classic",
  "Outline",
  "Yellow Pop",
  "Comic",
  "Headline",
  "Banner",
] as const;

/** English in the UI; the TTS layer underneath is already multilingual. */
export const LANGUAGES = [{ code: "en", label: "English" }] as const;

/**
 * Aspect ratios, labelled with what each one is actually FOR.
 *
 * "4:5" tells you nothing at the moment you're choosing; "Instagram /
 * LinkedIn post" tells you everything. The leading token is the real value --
 * convex/slideshow.ts splits on the first space and checks the result against
 * render-service's DIMENSIONS map, so these labels can be reworded without
 * the server caring, but the RATIO in front must stay a key of that map.
 */
export const ASPECT_RATIOS = [
  "16:9 — YouTube",
  "9:16 — Instagram Reels & Stories",
  "1:1 — Facebook feed post",
  "4:5 — Instagram / LinkedIn post",
  "3:4 — Instagram feed",
] as const;

/**
 * The curated Google Fonts from the old app's settings page, shared by the
 * subtitle and branding pickers. Not exhaustive -- the APIs underneath accept
 * any Google Font -- just a closed set of bold, legible choices for a
 * dropdown.
 */
export const GOOGLE_FONTS = [
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Poppins",
  "Oswald",
  "Bebas Neue",
  "Anton",
  "Inter",
  "Nunito",
  "Lato",
  "Bangers",
  "Archivo Black",
] as const;

/**
 * Named CSS colours double as valid values for auto-subtitle's font_color /
 * highlight_color / stroke_color, so no hex conversion is needed anywhere
 * between this dropdown and fal.
 */
export const SUBTITLE_COLORS = [
  "white",
  "black",
  "yellow",
  "red",
  "green",
  "blue",
  "purple",
  "orange",
  "pink",
  "cyan",
] as const;

/**
 * fal-ai/topaz/upscale/video's real `model` enum, copied from the old app's
 * settings page -- which verified it against fal's own API reference rather
 * than guessing, since a wrong string here fails a paid render.
 *
 * "Gaia 2" leads because it suits this app's own generated/animated output
 * and costs half of Proteus at the same output tier.
 */
export const TOPAZ_MODELS = [
  "Gaia 2",
  "Proteus",
  "Artemis HQ",
  "Artemis MQ",
  "Artemis LQ",
  "Gaia HQ",
  "Gaia CG",
  "Nyx",
  "Nyx Fast",
  "Nyx XL",
  "Nyx HF",
  "Starlight Precise 1",
  "Starlight Precise 2",
  "Starlight Precise 2.5",
  "Starlight HQ",
  "Starlight Mini",
  "Starlight Sharp",
  "Starlight Fast 1",
  "Starlight Fast 2",
] as const;

/**
 * ElevenLabs' premade voices. The same list convex/drama.ts casts from, minus
 * its per-voice notes -- a narrator is chosen by ear from a dropdown, not
 * described to a model.
 */
export const VOICES = [
  "Sarah",
  "Rachel",
  "Laura",
  "Charlotte",
  "Alice",
  "Matilda",
  "Jessica",
  "Lily",
  "Aria",
  "Roger",
  "Charlie",
  "George",
  "Callum",
  "Liam",
  "Will",
  "Eric",
  "Chris",
  "Brian",
  "Daniel",
  "Bill",
  "River",
] as const;

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

  /**
   * Several images as one value, held as an array of asset ids in order.
   *
   * The order is the meaning, not a detail: a composite step names each
   * reference by its index in the prompt ("Image 2 is Character 1"), which is
   * how a recurring cast stays recognisable from slide to slide.
   */
  images: (o: Omit<SimpleField, "kind">): SimpleField => ({
    kind: "images",
    maxItems: 4,
    ...o,
  }),
  video: (o: Omit<SimpleField, "kind">): SimpleField => ({ kind: "video", ...o }),

  /**
   * A hex colour, drawn by the browser's native picker.
   *
   * Not a choice of named swatches like the subtitle colours: a brand colour
   * has an exact value, and offering ten approximations of it is worse than
   * offering none.
   */
  color: (o: Omit<SimpleField, "kind">): SimpleField => ({ kind: "color", ...o }),

  language: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "language",
    label: "Language",
    default: "en",
    ...o,
  }),

  /**
   * `none` offers "None" ahead of the styles -- for a format with no separate
   * caption switch, where the style is the only place to say "no captions" --
   * and makes it the default.
   */
  captionStyle: ({
    none = false,
    ...o
  }: Partial<Omit<ChoiceField, "kind" | "options">> & { none?: boolean } = {}): ChoiceField => ({
    kind: "captionStyle",
    label: "Caption style",
    options: none ? ["None", ...CAPTION_STYLES] : CAPTION_STYLES,
    default: none ? "None" : "Classic",
    ...o,
  }),

  /**
   * Which Kling tier animates the clip, for every format with a P3 step.
   * Standard is the default because it measured level with Pro on the same
   * story and the same staged frames, for 25% less and in half the time;
   * Pro is there for a final render. Mirrored by CLIP_MODELS in
   * convex/lib/klingClip.ts and RATES.klingPerSec in src/lib/estimate.ts.
   */
  videoModel: (o?: Partial<Omit<ChoiceField, "kind" | "options">>): ChoiceField => ({
    kind: "choice",
    label: "Video model",
    options: ["Kling 3 Standard", "Kling 3 Pro"],
    default: "Kling 3 Standard",
    help: "Standard is the default. Pro is sharper on faces and hands, and about 33% dearer.",
    ...o,
  }),

  /**
   * Whether captions are burned in at all. Separate from Caption style, which
   * only says what they look like -- the P8 step is skipped entirely when this
   * is off, so it is a pipeline condition rather than a cosmetic choice.
   */
  captionOverlay: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "toggle",
    label: "Caption overlay",
    default: true,
    ...o,
  }),

  /**
   * P10. "Who's cutting", "Avatar" and "Presenter" are all this field, drawn
   * as the casting popup (Anyone / Influencers / Pre-made / My images).
   * Starts on "Anyone" -- a fresh pre-made face per run -- so a format that
   * needs a face never opens blank; a field that can be empty overrides it.
   */
  avatar: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "avatar",
    label: "AI influencer",
    default: "cast:any",
    ...o,
  }),

  /** P9. Renders as a filterable grid over the ingested clip library. */
  trendingClip: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "trendingClip",
    label: "Trending video",
    ...o,
  }),

  /**
   * The hook popup: a finished clip (trending, or one of My hooks) or a
   * person to perform a new one. Holds "clip:<id>", "video:<assetId>" or a
   * roster ref -- see convex/lib/videoRef.ts and convex/lib/roster.ts.
   */
  hook: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "hook",
    label: "Hook",
    ...o,
  }),

  /**
   * Pick an existing audio clip or upload a new one -- the spec's "select
   * audio clip templates or upload a new audio clip", one control rather than
   * a dropdown next to an upload button.
   */
  audioClip: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "audioClip",
    label: "Audio",
    ...o,
  }),

  /**
   * The Images popup: a stock image set (Pexels + Pixabay) or the client's own
   * uploads. Holds `set:<id>` or `uploads:<assetId>,...` -- see
   * convex/lib/imageSets.ts.
   */
  imageSource: (o?: Partial<Omit<SimpleField, "kind">>): SimpleField => ({
    kind: "imageSource",
    label: "Images",
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
    help: "Written from your saved business profile (the sign-up quiz).",
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
