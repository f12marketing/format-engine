import { defineFormat } from "./types";
import { field } from "./fields";
import { DEFAULT_IMAGE_SET, setValue } from "../../convex/lib/imageSets";

/**
 * Image Slideshow: the swipeable photo deck with text on every slide -- a
 * confession in white highlight boxes over warm lifestyle photos, numbered
 * tips over dark gym shots, rules in boxes over a desk at night.
 *
 * Three questions, then the editor. The images are a stock set (Gym, Sunsets,
 * Work/Career...) or the client's own uploads, and a set also decides how the
 * words sound and sit; the prompt says what it is about. Every slide is then
 * editable before anything is exported -- move and restyle text, swap or add
 * images, add overlays and slides -- on the job page, while the run waits at
 * its `edit` gate.
 */
export default defineFormat({
  id: "image-slideshow",
  name: "Image Slideshow",
  blurb: "Photo slideshow with text on every slide — from an image set or your own photos, then yours to edit",
  icon: "📸",
  group: "decks",
  preview: "deck",
  status: "ready",
  phase: 1,

  config: {
    mentionBusiness: field.mentionBusiness(),
    images: field.imageSource({
      default: setValue(DEFAULT_IMAGE_SET),
      help: "Choose an image set, or upload your own. Each slide gets one of these photos.",
    }),
    prompt: field.longText({
      label: "Prompt",
      required: true,
      improvable: true,
      rows: 4,
      maxLength: 1000,
      placeholder: "What should the slideshow be about? e.g. how I stopped overthinking every post",
      help: "The topic. Improve turns a few words into a sharper brief for the images you picked.",
    }),
  },

  pipeline: [
    // Skipped by "Edit slides again", which reopens a finished deck as it was.
    {
      id: "copy",
      primitive: "P1",
      label: "Write the slides and match the photos",
      when: { field: "deck", is: "empty" },
    },
    // The editor: the run waits here while the slides are edited.
    { id: "edit", primitive: "P8", label: "Edit the slides", gate: true },
    { id: "render", primitive: "P8", label: "Export the slides" },
  ],
});
