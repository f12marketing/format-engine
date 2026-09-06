import { defineFormat } from "./types";
import { field } from "./fields";

/**
 * Phase 0. The whole format, and the one that proves the spine.
 *
 * It touches every layer -- registry, config panel, workflow, render service,
 * asset storage, ledger -- while calling exactly one paid model, so a full end
 * to end run costs about three cents and the loop can be driven twenty times a
 * day. And because it outputs stills rather than video, it forces `preview` to
 * be a real abstraction before anything is built on the assumption that every
 * format ends in a player.
 */
export default defineFormat({
  id: "carousel",
  name: "Carousel",
  blurb: "Swipeable social slide deck, rendered from a template",
  icon: "🎠",
  group: "decks",
  preview: "deck",
  shipsToday: true,
  status: "ready",
  phase: 0,

  config: {
    logline: field.longText({
      label: "Logline or script",
      placeholder:
        "Paste the whole thing. Long input is normal here -- the deck is cut from it.",
      help: "One line or two thousand words; the prompt handles both.",
    }),
    slideCount: field.count({
      label: "Slides",
      min: 5,
      max: 12,
      default: 7,
      help: "Seven reads best on LinkedIn. Twelve is the platform ceiling.",
    }),
    template: field.choice({
      label: "Template",
      options: [
        "bold-statement",
        "editorial-serif",
        "dark-mode",
        "numbered-list",
        "gradient-pop",
        "minimal-grid",
      ],
      default: "bold-statement",
    }),
    aspectRatio: field.choice({
      label: "Aspect ratio",
      options: ["4:5", "1:1"],
      default: "4:5",
      help: "4:5 is the Instagram and LinkedIn carousel standard.",
    }),
    mentionBusiness: field.mentionBusiness(),
  },

  /**
   * Two steps, and only the first one costs anything. The render is headless
   * Chrome over the same templates the browser previews, which is what makes
   * preview and export agree by construction rather than by discipline.
   */
  pipeline: [
    {
      id: "copy",
      primitive: "P1",
      label: "Write the deck",
      // A hand-written deck skips straight to rendering.
      when: { field: "deck", is: "empty" },
    },
    {
      id: "render",
      primitive: "P8",
      label: "Render slides and PDF",
      options: { renderer: "carousel-templates", outputs: ["png", "pdf", "caption"] },
    },
  ],
});
