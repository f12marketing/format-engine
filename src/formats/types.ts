/**
 * A format is a declaration, not a module.
 *
 * Config fields render the left-hand panel and validate on submit; pipeline
 * steps become a Convex workflow. Nothing here imports React or Convex, so the
 * same declaration is readable from the browser, the server and a script.
 */

/** The ten primitives. A format's pipeline is a sequence of these. */
export type Primitive =
  | "P1" // Copy
  | "P2" // Image gen
  | "P3" // Image -> video
  | "P4" // Speech
  | "P5" // Avatar / lipsync
  | "P6" // Character swap
  | "P7" // Composite (ffmpeg)
  | "P8" // Type & captions (Remotion / headless Chrome)
  | "P9" // Clip library
  | "P10"; // Avatar library

/** What the right-hand panel shows. Carousel is why this isn't just "video". */
export type PreviewMode = "video" | "deck" | "image";

/** Picker groups, ordered by what comes out rather than by which model runs. */
export type FormatGroup =
  | "decks"
  | "slides-text"
  | "trending"
  | "avatars"
  | "generated"
  | "swap-custom";

export type FieldKind =
  | "shortText"
  | "longText"
  | "choice"
  | "toggle"
  | "seconds"
  | "count"
  | "image"
  | "images"
  | "video"
  | "color"
  | "language"
  | "captionStyle"
  | "avatar"
  | "trendingClip"
  | "hook"
  | "audioClip"
  | "imageSource"
  | "mode";

export interface FieldBase {
  kind: FieldKind;
  label: string;
  help?: string;
  optional?: boolean;
  /**
   * Generate stays disabled while this is blank (and the field is showing).
   *
   * Opt-in, and deliberately separate from `optional`, which only controls
   * the "optional" tag on the label. A field with no tag is not necessarily
   * one the run cannot do without: Carousel's logline can be blank because a
   * hand-written deck stands in for it. So nothing is blocked unless its
   * format says so -- Slideshow and Video Animation's Script, which has no
   * fallback, are the ones that do.
   */
  required?: boolean;
  /**
   * Which primitive fills this in when the user leaves it blank. A Script
   * field with generatedBy "P1" is the difference between "required" and
   * "we'll write it for you".
   */
  generatedBy?: Primitive;
  /**
   * Moves the control out of the main panel and into the collapsed "Advanced
   * options" block. A format with thirty knobs and six that matter is
   * unusable otherwise -- and which six matter is the format's own
   * judgement, not the panel's.
   */
  advanced?: boolean;
  /**
   * Advanced fields sharing a group render together under that heading, in
   * declaration order. Named after the pipeline stage they configure
   * ("Voiceover", "Subtitles"), so the panel reads like the old settings page.
   */
  group?: string;
  /**
   * Hide the control unless this holds -- the same declarative condition a
   * step's `when` uses, and for the same reason: a closure cannot cross the
   * Server Component boundary, and a frozen config snapshot has to stay
   * explainable six weeks later.
   *
   * Every group whose stage is optional points its sub-fields at that group's
   * own toggle, so switching Voiceover off takes its voice and language with
   * it rather than leaving dead controls on screen.
   */
  showWhen?: StepCondition;
  /**
   * Starts a new visual section in the main panel: a divider and this
   * heading, drawn above the first *showing* field that names it -- so a
   * section whose opening field is hidden still gets its heading.
   */
  section?: string;
}

/**
 * Caption style and Mode render exactly like a choice but keep their own kind,
 * so the panel can give them a dedicated control later without the format
 * declarations changing.
 */
export type ChoiceLikeKind = "choice" | "captionStyle" | "mode";

export interface ChoiceField extends FieldBase {
  kind: ChoiceLikeKind;
  options: readonly string[];
  default?: string;
  /**
   * Puts a "play a sample" button beside the select. `"voice"` speaks one
   * short line in the chosen voice, using the sibling `voiceStability` and
   * `language` fields when the format declares them -- the same keys the run
   * reads, so the sample is what the run will generate.
   */
  preview?: "voice";
}

export interface SecondsField extends FieldBase {
  kind: "seconds";
  min: number;
  max: number;
  default: number;
}

export interface CountField extends FieldBase {
  kind: "count";
  min: number;
  max: number;
  default: number;
}

export interface TextField extends FieldBase {
  kind: "shortText" | "longText";
  placeholder?: string;
  /** Enforced by the control, and shown as a counter under a long text. The server checks it again -- the form is not the boundary. */
  maxLength?: number;
  /** Visible lines of a long text. Defaults to 4; a script wants more. */
  rows?: number;
  /**
   * Puts a rewrite button under a long text, which rewrites what was typed
   * without saving anything -- the new text simply replaces the old in the
   * field. Names what it is rewritten into: a sharper brief for an Image
   * Slideshow ("Improve"), or a punchier hook caption ("Improvise").
   */
  improvable?: "slideshowPrompt" | "hookCaption";
  /** A word count to aim for, shown as a counter under a long text. Advisory: the panel doesn't cut anything. */
  words?: { min: number; max: number };
}

export interface SimpleField extends FieldBase {
  kind: Exclude<FieldKind, ChoiceLikeKind | "seconds" | "count" | "shortText" | "longText">;
  default?: string | boolean;
  /**
   * Video uploads normally accept a still too -- a "source" is either. A
   * bookend frame is not: it is spliced onto the timeline as its own segment,
   * so a PNG there would be a file the renderer has no duration for. This
   * narrows the picker to video/* AND re-checks the MIME on the chosen file,
   * because "All files" in the OS dialog defeats the accept attribute alone.
   */
  videoOnly?: boolean;
  /**
   * For "images": how many files the control accepts. A cast of recurring
   * characters is several reference sheets, not one -- but every edit model
   * degrades as the reference count climbs, so the control caps rather than
   * letting a deck of twenty be pasted in.
   */
  maxItems?: number;
  /**
   * For "audioClip": what choosing nothing means, as the picker labels it.
   * "Silent" on the generated-scene formats, where there is no other sound;
   * Wall of Text lays text over a real clip, so nothing there means the
   * clip keeps its own sound.
   */
  emptyLabel?: string;
  /**
   * For "avatar": whether the casting popup offers "A woman" / "A man" --
   * a fresh pre-made face per run. Default true; off where a stranger's face
   * makes no sense as the character (Skeleton).
   */
  casting?: boolean;
  /**
   * For "avatar": adds a Videos tab (trending library, your videos, upload),
   * so the field can hold either someone to film or a finished clip. Wall of
   * Text is the one format where both are the same question.
   */
  videos?: boolean;
  /**
   * For "hook": what a person picked in the hook popup does. "reaction" films
   * them reacting, silently (Video Hook & Demo), and adds the Trending tab;
   * "speaking" has them say a new line (Speaking Hook & Demo). Either way My
   * hooks offers the ones already made.
   */
  hookMode?: "reaction" | "speaking";
  /** For "language": the choices, where the format's voice speaks more than English. */
  languages?: readonly { code: string; label: string }[];
  /**
   * For the "Mention your business" toggle: the key of a text field that is
   * rewritten in the business's own voice the moment the toggle goes on, so
   * the effect is visible in the panel rather than only in the finished run.
   */
  personalizes?: string;
}

export type Field = ChoiceField | SecondsField | CountField | TextField | SimpleField;

/**
 * Step conditions are DATA, not predicates.
 *
 * A closure can't cross the server/client boundary, so a format definition
 * containing one can't be handed from a Server Component to the config panel.
 * Declarative conditions also mean the Convex workflow can evaluate a
 * pipeline without importing the registry, and a job's frozen config snapshot
 * stays explainable six weeks later.
 *
 * "empty" means unset, blank, or a toggle switched off -- so a step declared
 * `{ field: "captionOverlay", is: "present" }` runs only while that toggle is
 * on. Zero is a value, not an absence.
 */
export type StepCondition =
  | { field: string; is: "empty" | "present" }
  | { field: string; equals: string }
  | { field: string; notEquals: string }
  /**
   * A regular expression, as a string so it stays data. For a field whose
   * value is a tagged reference: Wall of Text films someone only when its
   * Video field is NOT a "clip:" or "video:" ref.
   */
  | { field: string; matches: string }
  | { field: string; notMatches: string };

export interface Step {
  /** Stable id -- this is what the job's steps[] and the ledger key off. */
  id: string;
  primitive: Primitive;
  label: string;
  /** Skip the step entirely when this doesn't hold (e.g. user wrote the script). */
  when?: StepCondition;
  /** Pause here and wait for the user to approve before continuing. */
  gate?: boolean;
  /** Free-form, read by the step runner for this primitive. */
  options?: Record<string, unknown>;
}

/**
 * One stage of a format's production line, drawn as a card inside the
 * Advanced options block: a title, the model behind it, a line on what it
 * does, and -- for a stage that can be left out -- an on/off switch in the
 * header. It is the old settings page's card, declared as data.
 */
export interface AdvancedCard {
  /** Matches `field.group` on every field that belongs to this card. */
  title: string;
  /** The model behind the stage, shown as a badge. Free text: not every stage is a fal model. */
  model?: string;
  blurb: string;
  /**
   * Config key of the toggle that switches this stage on. It is drawn as the
   * header switch instead of as a labelled control, and the card's other
   * fields appear only while it is on. Omit for a stage that always runs.
   */
  toggle?: string;
}

/** A run of cards under one heading -- the old page's Core pipeline / Optional extras / Branding. */
export interface AdvancedSection {
  title: string;
  blurb: string;
  cards: AdvancedCard[];
}

export interface FormatDefinition {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  group: FormatGroup;
  preview: PreviewMode;
  /** True for the three modes that already ship in the old app. */
  shipsToday?: boolean;
  /**
   * "ready" means the step runners for its pipeline exist. Planned formats
   * still appear in the picker -- the registry lists itself, and showing the
   * roadmap is more useful than hiding it -- but can't be entered yet.
   */
  status: "ready" | "planned";
  /** Build phase from the implementation plan. Drives the picker's badge. */
  phase: number;
  config: Record<string, Field>;
  /**
   * How the `advanced` fields are laid out. Optional: a format that marks
   * fields advanced without declaring this still gets them, grouped by
   * `field.group`, in a single unheaded section.
   */
  advancedSections?: AdvancedSection[];
  pipeline: Step[];
}

export function defineFormat(def: FormatDefinition): FormatDefinition {
  return def;
}

/**
 * Evaluate one declarative condition against a config snapshot.
 *
 * Shared by steps (`when`) and fields (`showWhen`) so that "Voiceover is off"
 * means the same thing to the panel, the estimate and the workflow. Three
 * readings of one toggle that could drift apart is exactly the bug this
 * avoids.
 */
export function conditionHolds(
  c: StepCondition | undefined,
  config: Record<string, unknown>,
): boolean {
  if (!c) return true;
  const value = config[c.field];
  if ("equals" in c) return value === c.equals;
  if ("notEquals" in c) return value !== c.notEquals;
  if ("matches" in c) return typeof value === "string" && new RegExp(c.matches).test(value);
  if ("notMatches" in c) return !(typeof value === "string" && new RegExp(c.notMatches).test(value));
  const empty = value === undefined || value === null || value === "" || value === false;
  return c.is === "empty" ? empty : !empty;
}

/** Evaluate a step's condition against a config snapshot. */
export function stepApplies(step: Step, config: Record<string, unknown>): boolean {
  return conditionHolds(step.when, config);
}

/** Whether a field's control should be on screen at all, given what's set so far. */
export function fieldApplies(field: Field, config: Record<string, unknown>): boolean {
  return conditionHolds(field.showWhen, config);
}

/**
 * The fields a format marks `required` that are showing and still blank -- what
 * keeps Generate off. A field the panel is hiding is never required.
 */
export function missingRequired(
  format: FormatDefinition,
  values: Record<string, unknown>,
): Field[] {
  const blank = (v: unknown) =>
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0);
  return Object.entries(format.config)
    .filter(([key, field]) => field.required && fieldApplies(field, values) && blank(values[key]))
    .map(([, field]) => field);
}

/**
 * The config a run actually uses: `values` minus every field the panel is
 * not showing.
 *
 * Hiding a control does not clear its value, and that matters. Switch
 * Subtitles on, then Voiceover off: the Subtitles card disappears but
 * `subtitles` is still true, so a step declared `when: subtitles present`
 * would run -- and be billed -- for a stage the user can no longer see.
 * Steps, the estimate and the config frozen onto the job all read this
 * instead, so what runs is exactly what is on screen. The raw values stay in
 * the panel's state, so switching a stage back on restores its settings.
 *
 * Walked in declaration order, which is what resolves chains: Subtitles
 * depends on Voiceover, and Subtitles' own fields depend on Subtitles, so
 * dropping the first drops the rest. A format must therefore declare a
 * field after the one its `showWhen` names -- which every one reads
 * naturally as anyway.
 */
export function effectiveConfig(
  format: FormatDefinition,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...values };
  for (const [key, field] of Object.entries(format.config)) {
    if (!fieldApplies(field, out)) delete out[key];
  }
  return out;
}
