/**
 * The carousel templates, as data: one entry per stylesheet in
 * `src/carousel-templates/` (mirrored from render-service/carousel-templates,
 * whose manifest.json this list is taken from).
 *
 * The one list feeds the format's Template choice, the live template picker,
 * and the server-side check that a re-render names a template that exists --
 * so adding a template is a stylesheet plus one line here, not a hunt.
 *
 * Plain data with no imports, so the client bundle can take it as-is.
 */
export const CAROUSEL_TEMPLATES = [
  {
    id: "bold-statement",
    name: "Bold Statement",
    blurb: "Huge type on flat color. Punchy and opinionated.",
  },
  {
    id: "editorial-serif",
    name: "Editorial Serif",
    blurb: "Cream ground, serif headline, wide margins. Thought leadership.",
  },
  {
    id: "dark-mode",
    name: "Dark Mode",
    blurb: "Near-black with a bright keyline. Reads native to a dev audience.",
  },
  {
    id: "numbered-list",
    name: "Numbered List",
    blurb: "Oversized slide number as the design. Built for listicles.",
  },
  {
    id: "gradient-pop",
    name: "Gradient Pop",
    blurb: "Soft gradient behind a floating card. Consumer and lifestyle.",
  },
  {
    id: "minimal-grid",
    name: "Minimal Grid",
    blurb: "White, hairline rules, generous whitespace. Corporate and B2B.",
  },
] as const;

export const CAROUSEL_TEMPLATE_IDS: readonly string[] = CAROUSEL_TEMPLATES.map((t) => t.id);

export const DEFAULT_CAROUSEL_TEMPLATE = "bold-statement";
