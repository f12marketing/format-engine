import type { FormatDefinition, FormatGroup } from "./types";
import carousel from "./carousel";
import * as planned from "./planned";

/**
 * The registry. This array is the single source of truth for the picker, the
 * config panel and the job runner -- add a format here and all three learn
 * about it at once. There is no other route into the app.
 */
export const FORMATS: FormatDefinition[] = [
  carousel,
  planned.slideshow,
  planned.wallOfText,
  planned.custom,
  planned.videoAnimation,
  planned.videoHookDemo,
  planned.greenScreenMeme,
  planned.talkingHeadUgc,
  planned.speakingHookDemo,
  planned.talkingHeadGreenScreen,
  planned.productSpokesperson,
  planned.greenScreenMobile,
  planned.cuttingFruit,
  planned.onAWalk,
  planned.netflixDocumentary,
  planned.claymation,
  planned.lego,
  planned.felt,
  planned.talkingObjects,
  planned.skeleton,
  planned.streetInterview,
  planned.aiNewsAnchor,
  planned.characterSwap,
];

/** Picker groups, ordered by what comes out rather than by which model runs. */
export const GROUPS: { id: FormatGroup; label: string }[] = [
  { id: "decks", label: "Decks" },
  { id: "slides-text", label: "Slides & text" },
  { id: "trending", label: "Trending clips" },
  { id: "avatars", label: "Talking avatars" },
  { id: "generated", label: "Generated scenes" },
  { id: "swap-custom", label: "Swap & custom" },
];

export function getFormat(id: string): FormatDefinition | undefined {
  return FORMATS.find((f) => f.id === id);
}

export function formatsInGroup(group: FormatGroup): FormatDefinition[] {
  return FORMATS.filter((f) => f.group === group);
}

export * from "./types";
export { field, CAPTION_STYLES, LANGUAGES } from "./fields";
