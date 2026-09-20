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
  | "video"
  | "language"
  | "captionStyle"
  | "avatar"
  | "trendingClip"
  | "audioClip"
  | "mode";

export interface FieldBase {
  kind: FieldKind;
  label: string;
  help?: string;
  optional?: boolean;
  /**
   * Which primitive fills this in when the user leaves it blank. A Script
   * field with generatedBy "P1" is the difference between "required" and
   * "we'll write it for you".
   */
  generatedBy?: Primitive;
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
  maxLength?: number;
}

export interface SimpleField extends FieldBase {
  kind: Exclude<FieldKind, ChoiceLikeKind | "seconds" | "count" | "shortText" | "longText">;
  default?: string | boolean;
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
  | { field: string; notEquals: string };

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
  pipeline: Step[];
}

export function defineFormat(def: FormatDefinition): FormatDefinition {
  return def;
}

/** Evaluate a step's condition against a config snapshot. */
export function stepApplies(step: Step, config: Record<string, unknown>): boolean {
  const c = step.when;
  if (!c) return true;
  const value = config[c.field];
  if ("equals" in c) return value === c.equals;
  if ("notEquals" in c) return value !== c.notEquals;
  const empty = value === undefined || value === null || value === "" || value === false;
  return c.is === "empty" ? empty : !empty;
}
