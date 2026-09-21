import { defineFormat } from "./types";
import { ASPECT_RATIOS, field } from "./fields";
import { BRANDING_SECTION, extrasFields, optionalExtrasSection } from "./extras";

/**
 * Video Animation: a logline in, a finished animated video out -- story,
 * characters, a shot list, each shot composited and animated, dialogue laid
 * on, everything stitched.
 *
 * It is the old app's flagship, and its settings page was the model for the
 * Advanced block below: every stage of the pipeline is a card, in the old
 * page's own order -- Character & Background Images, Composite Scenes, Video
 * Clips, then the optional extras and branding. They live on the format now
 * rather than on a global page, so they are part of the config snapshot
 * `run.generate` freezes onto the job: two animations can disagree about
 * voiceover or clip model and both still be explainable six weeks later.
 *
 * Option labels below are read verbatim by convex/videoAnimation.ts and
 * convex/lib/klingClip.ts -- rename one there too, or the server falls back
 * to its default.
 */
export default defineFormat({
  id: "video-animation",
  name: "Video Animation",
  blurb: "Story to characters to shots to a finished animated video",
  icon: "🎬",
  group: "generated",
  preview: "video",
  shipsToday: true,
  status: "ready",
  phase: 2,

  config: {
    logline: field.longText({ label: "Logline or script" }),
    durationSec: field.seconds({
      label: "Target length",
      min: 15,
      max: 90,
      default: 30,
      help: "Shots are 5s each, so this sets roughly how many the story is broken into.",
    }),
    style: field.choice({
      label: "Image style",
      options: [
        "Pixar 3D",
        "Anime",
        "Watercolor",
        "Photorealistic",
        "Hyper-realistic",
        "Claymation",
      ],
      default: "Pixar 3D",
    }),
    aspectRatio: field.choice({
      label: "Aspect ratio",
      options: ASPECT_RATIOS,
      default: "16:9 — YouTube",
      help: "Sets the frame every image is generated at and the video is cut to.",
    }),
    mentionBusiness: field.mentionBusiness(),

    /**
     * The old app's bookend frames -- "plays before the animation". Video
     * only, and deliberately so: these are spliced onto the timeline as their
     * own segments, so a still has no duration to splice.
     */
    startFrameAssetId: field.video({
      label: "Start frame",
      optional: true,
      videoOnly: true,
      help: "Plays before the animation. Video files only.",
    }),
    endFrameAssetId: field.video({
      label: "End frame",
      optional: true,
      videoOnly: true,
      help: "Plays after the animation. Video files only.",
    }),

    // ---------------------------------------- Character & Background Images
    // The character sheets are always 1:1 and the backgrounds always take the
    // aspect ratio above, so the old card's two ratio dropdowns and its
    // images-per-prompt count have nothing left to decide.
    imageOutputFormat: field.choice({
      label: "Output format",
      options: ["png", "jpeg"],
      default: "png",
      advanced: true,
      group: "Character & Background Images",
    }),
    imageSafetyTolerance: field.choice({
      label: "Safety tolerance (1 strict – 6 permissive)",
      options: ["1", "2", "3", "4", "5", "6"],
      default: "4",
      advanced: true,
      group: "Character & Background Images",
    }),

    // ---------------------------------------------------- Composite Scenes
    // Blends each shot's background plate with the characters in it. The
    // image size follows the aspect ratio, so it is not a control here.
    compositeOutputFormat: field.choice({
      label: "Output format",
      options: ["jpeg", "png"],
      default: "jpeg",
      advanced: true,
      group: "Composite Scenes",
    }),
    compositeSafetyChecker: field.toggle({
      label: "Enable safety checker",
      default: true,
      advanced: true,
      group: "Composite Scenes",
      help: "fal's check on each generated image. The separate check on the prompt text always runs.",
    }),

    // --------------------------------------------------------- Video Clips
    /**
     * Below Composite Scenes, as on the old page. The old card's Resolution
     * and "ambient audio" controls belonged to Vidu; this format animates with
     * Kling 3, which has neither -- it takes a duration and works out the
     * frame from the image it is given, and the app asks it for silence
     * because dialogue and music are laid on in the render.
     *
     * Standard is the default because it held characters, sets and hands just
     * as well as Pro in head-to-head tests on the same frames, for a quarter
     * less and in half the time (see convex/lib/klingClip.ts).
     */
    videoModel: field.choice({
      label: "Video model",
      options: ["Kling 3 Standard", "Kling 3 Pro"],
      default: "Kling 3 Standard",
      advanced: true,
      group: "Video Clips",
      help: "Standard held faces and hands as well as Pro in testing, for about 25% less. Pro is there for a final render.",
    }),

    // Voiceover, music, subtitles, upscale, branding: shared with Slideshow --
    // see extras.ts. Voiceover starts ON here: dialogue is what this format
    // has always done, and a job that never mentions it must still speak.
    ...extrasFields({ voiceover: true }),
  },

  /**
   * The old settings page's own grouping, kept: Core pipeline, Optional
   * extras, Branding. Every Core stage always runs, so none of those cards has
   * a switch -- turning off Video Clips would leave a slideshow, which is its
   * own format.
   */
  advancedSections: [
    {
      title: "Core pipeline",
      blurb: "Runs on every render — the actual image, composite and video generation.",
      cards: [
        {
          title: "Character & Background Images",
          model: "fal-ai/nano-banana-2",
          blurb:
            "Generates the character reference sheets and the background plates each scene is built from.",
        },
        {
          title: "Composite Scenes",
          model: "alibaba/qwen-image-3/edit",
          blurb: "Blends a background plate with the shot's characters into one scene image.",
        },
        {
          title: "Video Clips",
          model: "fal-ai/kling-video/v3/{standard,pro}/image-to-video",
          blurb:
            "Animates each composite into a clip, then joins them with ffmpeg. Clips are generated silent — dialogue and music are laid on afterwards.",
        },
      ],
    },
    optionalExtrasSection({
      voiceoverBlurb: "Speaks each shot's dialogue, in the voice you pick.",
      subtitlesBlurb:
        "Word-by-word captions transcribed from the dialogue and burned in — in place of the plain per-shot captions, so no line appears twice.",
    }),
    BRANDING_SECTION,
  ],

  /**
   * Three gates, which is why porting this early was worth it: the approval
   * step type it forces is the same one Product Spokesperson needs later.
   *
   * "stitch" absorbs what would have been a separate "captions" step -- same
   * reasoning as Custom's composite step: burning captions in is the same
   * ffmpeg invocation as the mux, so a second declared step would describe
   * two things happening when only one encode actually runs. Bookend frames,
   * the branded cards and the music bed fold into it for the same reason.
   *
   * Voice, music, upscale and subtitles are conditional. Order after the
   * stitch is deliberate: subtitles come last, because burning them in
   * before an upscale would upscale the text too.
   */
  pipeline: [
    { id: "story", primitive: "P1", label: "Write the story", gate: true },
    { id: "characters", primitive: "P2", label: "Design characters and backgrounds", gate: true },
    { id: "shots", primitive: "P1", label: "Build the shot list", gate: true },
    { id: "scenes", primitive: "P2", label: "Composite each scene" },
    { id: "clips", primitive: "P3", label: "Animate each shot" },
    {
      id: "voice",
      primitive: "P4",
      label: "Record voiceover",
      when: { field: "voiceover", is: "present" },
    },
    {
      id: "music",
      primitive: "P4",
      label: "Score the video",
      when: { field: "backgroundMusic", is: "present" },
    },
    { id: "stitch", primitive: "P7", label: "Stitch, caption and mux" },
    {
      id: "upscale",
      primitive: "P3",
      label: "Upscale the video",
      when: { field: "videoUpscale", is: "present" },
    },
    {
      id: "subtitles",
      primitive: "P8",
      label: "Burn in subtitles",
      when: { field: "subtitles", is: "present" },
    },
  ],
});
