import type { AdvancedSection, Field } from "./types";
import { GOOGLE_FONTS, SUBTITLE_COLORS, TOPAZ_MODELS, VOICES, field } from "./fields";

/**
 * The production line's optional extras -- voiceover, music, subtitles,
 * upscale and branding -- declared once for every format that offers them.
 *
 * Slideshow wrote them inline first. Video Animation needs exactly the same
 * seven-odd controls with the same option lists and the same limits, and a
 * second copy is the version that drifts: one format's stroke-width ceiling
 * corrected and the other's not. The server reads these keys the same way in
 * both (convex/lib/extras.ts), so a rename here is a rename there.
 *
 * Declaration ORDER is load-bearing. `effectiveConfig` walks fields in the
 * order they are declared and drops any whose `showWhen` fails, so a field
 * must come after the one it names -- Subtitles after Voiceover, and each
 * group's settings after its own switch. Spread this into a format's config
 * as a block; do not reorder within it.
 */
export function extrasFields(opts: {
  voiceover: boolean | "always";
  /** Whether Subtitles starts switched on. Off unless a format says otherwise. */
  subtitles?: boolean;
}): Record<string, Field> {
  // "always": the video is cut to its voiceover (Slideshow, Video Animation),
  // so there is no switch to declare and nothing to hide the voice settings
  // behind -- they are simply there.
  const always = opts.voiceover === "always";
  const whenVoiceover = always ? {} : { showWhen: { field: "voiceover", is: "present" } as const };

  return {
    // ------------------------------------------------------------ Voiceover
    ...(always
      ? {}
      : {
          voiceover: field.toggle({
            label: "Voiceover",
            default: opts.voiceover as boolean,
            advanced: true,
            group: "Voiceover",
          }),
        }),
    voice: field.choice({
      label: "Voice",
      options: VOICES,
      default: "Sarah",
      advanced: true,
      group: "Voiceover",
      ...whenVoiceover,
      preview: "voice",
      help: "Play a sample to hear this voice with the Delivery you've picked.",
    }),
    /**
     * eleven-v3's three discrete stability settings, not the old card's 0-1
     * slider: `speed`, `similarity_boost` and `style` simply do not exist on
     * v3, and a continuous control the model rounds to three values lies
     * about what the knob does. See convex/lib/speechPrimitive.ts.
     */
    voiceStability: field.choice({
      label: "Delivery",
      options: ["Creative", "Natural", "Robust"],
      default: "Natural",
      advanced: true,
      group: "Voiceover",
      ...whenVoiceover,
      help: "Creative is the most expressive and the least predictable; Robust is the steadiest.",
    }),
    language: field.language({
      advanced: true,
      group: "Voiceover",
      ...whenVoiceover,
    }),

    // ----------------------------------------------------- Background Music
    backgroundMusic: field.toggle({
      label: "Background music",
      default: false,
      advanced: true,
      group: "Background Music",
    }),
    musicPrompt: field.longText({
      label: "Music prompt",
      optional: true,
      advanced: true,
      group: "Background Music",
      showWhen: { field: "backgroundMusic", is: "present" },
      placeholder: "Mood, genre, instruments, tempo. Leave blank to score it from the script.",
    }),
    musicVolume: field.choice({
      label: "Mix level",
      options: ["Subtle", "Balanced", "Prominent"],
      default: "Subtle",
      advanced: true,
      group: "Background Music",
      showWhen: { field: "backgroundMusic", is: "present" },
      help: "How loud the bed sits under a voiceover. Music on its own always plays at full level.",
    }),

    // ------------------------------------------------------------ Subtitles
    /**
     * Burned-in word-by-word subtitles, transcribed from the finished audio.
     * They are the only text a video carries -- there are no separate captions
     * drawn under them -- and with nothing to transcribe unless there is a
     * voiceover, the whole group hides until one is switched on.
     */
    subtitles: field.toggle({
      label: "Subtitles",
      default: opts.subtitles ?? false,
      advanced: true,
      group: "Subtitles",
      ...whenVoiceover,
    }),
    subtitleFont: field.choice({
      label: "Font",
      options: GOOGLE_FONTS,
      default: "Montserrat",
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitleFontColor: field.choice({
      label: "Font colour",
      options: SUBTITLE_COLORS,
      default: "white",
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitleHighlightColor: field.choice({
      label: "Karaoke highlight",
      options: SUBTITLE_COLORS,
      default: "yellow",
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitleStrokeColor: field.choice({
      label: "Stroke colour",
      options: SUBTITLE_COLORS,
      default: "black",
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    // fal's auto-subtitle accepts 0-10 and rejects anything above, so the
    // control stops there rather than letting a valid-looking 15 fail a run.
    subtitleStrokeWidth: field.count({
      label: "Stroke width (px)",
      min: 0,
      max: 10,
      default: 4,
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitlePosition: field.choice({
      label: "Position",
      options: ["bottom", "center", "top"],
      default: "bottom",
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitleWordsPerLine: field.count({
      label: "Words per subtitle",
      min: 1,
      max: 12,
      default: 4,
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),
    subtitleAnimation: field.toggle({
      label: "Bounce entrance animation",
      default: true,
      advanced: true,
      group: "Subtitles",
      showWhen: { field: "subtitles", is: "present" },
    }),

    // -------------------------------------------------------- Video Upscale
    videoUpscale: field.toggle({
      label: "Video upscale",
      default: false,
      advanced: true,
      group: "Video Upscale",
    }),
    upscaleFactor: field.choice({
      label: "Upscale factor",
      options: ["2", "4"],
      default: "2",
      advanced: true,
      group: "Video Upscale",
      showWhen: { field: "videoUpscale", is: "present" },
    }),
    upscaleModel: field.choice({
      label: "Topaz model",
      options: TOPAZ_MODELS,
      default: "Gaia 2",
      advanced: true,
      group: "Video Upscale",
      showWhen: { field: "videoUpscale", is: "present" },
      help: "Gaia 2 suits generated and animated footage. Proteus suits live action.",
    }),
    upscaleH264: field.toggle({
      label: "H264 output (rather than H265)",
      default: true,
      advanced: true,
      group: "Video Upscale",
      showWhen: { field: "videoUpscale", is: "present" },
    }),

    // --------------------------------------------- Motion Graphics Branding
    /**
     * The old app rendered these in Remotion, locally, from a brand.json and
     * a logo dropped on disk. Here they are Chrome-drawn cards composited by
     * ffmpeg -- the route the caption layers already take -- so branding needs
     * no second renderer, no Node toolchain on the render box, and no file
     * placed by hand.
     */
    branding: field.toggle({
      label: "Motion graphics branding",
      default: false,
      advanced: true,
      group: "Motion Graphics Branding",
    }),
    brandName: field.shortText({
      label: "Institute / brand name",
      optional: true,
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandTagline: field.shortText({
      label: "Tagline",
      optional: true,
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandLogoAssetId: field.image({
      label: "Logo",
      optional: true,
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
      help: "Shown on both cards. A transparent PNG works best.",
    }),
    brandPrimaryColor: field.color({
      label: "Primary colour",
      default: "#111827",
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandAccentColor: field.color({
      label: "Accent colour",
      default: "#e11d48",
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandTextColor: field.color({
      label: "Text colour",
      default: "#ffffff",
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandFont: field.choice({
      label: "Font",
      options: GOOGLE_FONTS,
      default: "Montserrat",
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
    }),
    brandClosingMessage: field.longText({
      label: "Closing message",
      optional: true,
      advanced: true,
      group: "Motion Graphics Branding",
      showWhen: { field: "branding", is: "present" },
      placeholder: "Shown on the end screen. Blank leaves just the name and tagline.",
    }),
  };
}

/**
 * The Optional extras section. The two blurbs that name a format's own
 * vocabulary -- "slide" versus "shot" -- are passed in; everything else is the
 * same wherever the extras appear.
 */
export function optionalExtrasSection(o: {
  voiceoverBlurb: string;
  subtitlesBlurb: string;
  /** No switch on the Voiceover card: the video is cut to it, so it always runs. */
  voiceoverAlways?: boolean;
}): AdvancedSection {
  return {
    title: "Optional extras",
    blurb: o.voiceoverAlways
      ? "The voiceover always runs; the rest are each their own on/off switch."
      : "Each is its own on/off switch.",
    cards: [
      {
        title: "Voiceover",
        model: "fal-ai/elevenlabs/tts/eleven-v3",
        blurb: o.voiceoverBlurb,
        ...(o.voiceoverAlways ? {} : { toggle: "voiceover" }),
      },
      {
        title: "Background Music",
        model: "CassetteAI/music-generator",
        blurb: "Scores the video, ducked under the voiceover if there is one.",
        toggle: "backgroundMusic",
      },
      {
        title: "Subtitles",
        model: "fal-ai/workflow-utilities/auto-subtitle",
        blurb: o.subtitlesBlurb,
        toggle: "subtitles",
      },
      {
        title: "Video Upscale",
        model: "fal-ai/topaz/upscale/video",
        blurb:
          "A Topaz pass over the finished cut, before subtitles are burned in. Billed per second.",
        toggle: "videoUpscale",
      },
    ],
  };
}

export const BRANDING_SECTION: AdvancedSection = {
  title: "Branding",
  blurb: "Wraps the finished video in a title card and an end screen.",
  cards: [
    {
      title: "Motion Graphics Branding",
      model: "chrome + ffmpeg render — not a fal.ai model",
      blurb: "An optional title card and end screen, drawn to your brand.",
      toggle: "branding",
    },
  ],
};
