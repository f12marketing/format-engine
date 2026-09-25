import { defineFormat } from "./types";
import { field } from "./fields";

/**
 * Drama: a premise in, a finished short-form drama episode out -- a cast with
 * fixed faces and voices, beats of dialogue that actually lip-sync, and a
 * cliffhanger.
 *
 * The production line follows DramaClaw's (github.com/dramaclaw/dramaclaw)
 * and its recommended models, every one of them routed through fal. Only the
 * design is borrowed, not the code: DramaClaw is Elastic License 2.0, which
 * rules out serving it to clients as a hosted service, so every prompt and
 * line here is written fresh.
 *
 * What makes it drama rather than Video Animation is the filming step. Each
 * beat is shot by Seedance 2.0 in reference mode: the storyboard frame, the
 * on-screen characters' reference sheets and the beat's recorded line go in
 * together, so the clip comes back with the line spoken, lip-synced, in that
 * character's own voice -- no separate dub, no drift between shots.
 *
 * Option labels below are read verbatim by convex/drama.ts; rename one there
 * too or the server falls back to its default.
 */
export default defineFormat({
  id: "drama",
  name: "Drama",
  blurb: "Short drama episode with a cast, spoken dialogue and a cliffhanger",
  icon: "🎭",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 8,

  config: {
    premise: field.longText({
      label: "Premise or script",
      placeholder:
        "A logline, a synopsis, or a full scene. e.g. \"On her wedding day, a bride learns the groom's mother paid her to leave -- ten years ago.\"",
      help: "One line is enough. Longer input is condensed into a single episode.",
    }),
    genre: field.choice({
      label: "Genre",
      options: [
        "Romance",
        "Revenge",
        "Betrayal",
        "Family secrets",
        "Workplace",
        "Thriller",
        "Comedy",
        "Fantasy",
      ],
      default: "Revenge",
    }),
    style: field.choice({
      label: "Visual style",
      options: [
        "Realistic",
        "Anime",
        "Period drama",
        "Fantasy epic",
        "Post-apocalyptic",
        "1930s noir",
      ],
      default: "Realistic",
    }),
    durationSec: field.seconds({
      label: "Target length",
      min: 30,
      max: 90,
      default: 45,
      help: "Beats run 4-15s each, so this sets roughly how many the episode is cut into.",
    }),
    aspectRatio: field.choice({
      label: "Aspect ratio",
      options: ["9:16", "16:9", "1:1"],
      default: "9:16",
      help: "9:16 is the short-drama standard for TikTok, Reels and Shorts.",
    }),
    lead: field.avatar({
      label: "Lead actor",
      optional: true,
      help: "Cast one of your AI influencers as the lead, or leave it to us.",
      default: undefined,
      emptyLabel: "Cast everyone fresh",
    }),
    videoModel: field.choice({
      label: "Video model",
      options: ["Seedance 2.0 Fast", "Seedance 2.0"],
      default: "Seedance 2.0 Fast",
      help: "Fast is DramaClaw's default. Seedance 2.0 is sharper and about 25% dearer.",
    }),
    resolution: field.choice({
      label: "Resolution",
      options: ["720p", "480p"],
      default: "720p",
      help: "480p costs roughly half -- good for drafting a story before the real render.",
    }),
    storyboardModel: field.choice({
      label: "Storyboard model",
      options: ["GPT Image 2", "Nano Banana 2"],
      default: "GPT Image 2",
    }),
    music: field.choice({
      label: "Music",
      options: ["Auto", "Tense", "Romantic", "Melancholy", "Uplifting", "None"],
      default: "Auto",
      help: "Auto scores the episode to its own mood.",
    }),
    captionOverlay: field.captionOverlay({ label: "Subtitles" }),
    captionStyle: field.captionStyle(),
    language: field.language(),
    mentionBusiness: field.mentionBusiness(),
  },

  /**
   * Three gates, placed so each one guards the next expensive thing: the
   * script before any image is paid for, the cast before a storyboard is
   * drawn with it, and the storyboard before Seedance -- which is most of the
   * bill -- films a single second.
   */
  pipeline: [
    { id: "script", primitive: "P1", label: "Write the episode", gate: true },
    { id: "cast", primitive: "P2", label: "Cast the characters and sets", gate: true },
    { id: "storyboard", primitive: "P2", label: "Draw the storyboard", gate: true },
    { id: "voices", primitive: "P4", label: "Record the dialogue" },
    { id: "scenes", primitive: "P3", label: "Film each beat" },
    {
      id: "music",
      primitive: "P4",
      label: "Score the episode",
      when: { field: "music", notEquals: "None" },
    },
    { id: "cut", primitive: "P7", label: "Cut, subtitle and mix" },
  ],
});
