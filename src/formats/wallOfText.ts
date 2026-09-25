import { defineFormat } from "./types";
import type { StepCondition } from "./types";
import { field } from "./fields";

/**
 * Wall of Text: an unedited phone clip with one paragraph of text over it
 * for the whole video -- the confession, the "POV:", the question to camera
 * -- with the business mentioned the way someone mentions an app they use.
 *
 * The clip either exists already (a trending clip, your own upload) or is
 * filmed for you: pick someone in the same casting popup every
 * person-in-the-video format uses, and the run stages them in a casual
 * front-camera selfie and animates it into a short handheld clip.
 */

/** True while Video names a person to film, not a finished clip (see VideoLibrary's tags). */
const filming: StepCondition = { field: "video", notMatches: "^(clip|video):" };

export default defineFormat({
  id: "wall-of-text",
  name: "Wall of Text",
  blurb: "A paragraph of text over a casual phone clip",
  icon: "🔠",
  group: "slides-text",
  preview: "video",
  status: "ready",
  phase: 1,
  config: {
    mentionBusiness: field.mentionBusiness(),
    video: field.avatar({
      label: "Video",
      required: true,
      videos: true,
      help: "Pick who we film — or bring a clip you already have from the Videos tab.",
    }),
    setting: field.choice({
      label: "Where they're filming",
      options: ["Match the text", "Bedroom", "Car", "Kitchen", "Walking outside", "Desk", "Couch"],
      default: "Match the text",
      help: "“Match the text” picks a setting that fits what the text says.",
      showWhen: filming,
    }),
    duration: field.seconds({
      label: "Clip length",
      min: 4,
      max: 10,
      default: 6,
      help: "The references run 5–10 seconds: long enough to read, short enough to rewatch.",
      showWhen: filming,
    }),
    audio: field.audioClip({
      label: "Background music",
      optional: true,
      emptyLabel: "Original sound",
      help: "Keep the clip's own sound, or lay a track over it.",
    }),
    prompt: field.longText({
      label: "Prompt",
      required: true,
      rows: 4,
      maxLength: 500,
      placeholder:
        "What should appear on the video? e.g. a confession about how long invoicing used to take",
      help: "Written as a first-person, scroll-stopping paragraph. You can edit every word before it renders.",
    }),
  },
  pipeline: [
    // Skipped by "Edit again", which reopens a finished design with its text.
    {
      id: "copy",
      primitive: "P1",
      label: "Write the text",
      when: { field: "design", is: "empty" },
    },
    { id: "scene", primitive: "P2", label: "Stage the selfie", when: filming },
    { id: "film", primitive: "P3", label: "Film the clip", when: filming },
    // The studio: the run waits here while the text is styled and placed.
    { id: "style", primitive: "P8", label: "Style the text", gate: true },
    { id: "render", primitive: "P7", label: "Burn in and render" },
  ],
});
