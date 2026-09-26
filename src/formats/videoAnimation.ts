import { defineFormat } from "./types";
import { ASPECT_RATIOS, field } from "./fields";
import { BRANDING_SECTION, extrasFields, optionalExtrasSection } from "./extras";
import { SCRIPT_MAX_CHARS } from "../../convex/lib/scriptTiming";

/**
 * Video Animation: a script in, a finished animated video out -- spoken, with
 * a character-consistent, animated clip for every three seconds of it.
 *
 * The video is cut to its voiceover. The script is recorded first; however
 * long that takes (X seconds) becomes X / 3 shots. So there is no length to
 * choose -- it comes from the script. The cast and the shot list are still
 * reviewed before anything expensive is drawn or animated.
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
    /**
     * The words the voiceover speaks, and the whole of the video's timing. It
     * is recorded first; its length divided by three is the number of shots,
     * and each shot is planned around the words spoken while it is on screen
     * (convex/lib/scriptTiming.ts). Required: it is the video's only source of
     * length and of story, so nobody is ever asked how long the video should be.
     */
    script: field.longText({
      label: "Script",
      required: true,
      maxLength: SCRIPT_MAX_CHARS,
      rows: 7,
      placeholder: "The words you want spoken, e.g. the story you want told.",
      help: "Recorded as the voiceover first. Each shot then runs 3 seconds, so a 60-second script becomes 20 shots.",
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
    // see extras.ts. The voiceover is not optional here: it is what the video
    // is cut to.
    ...extrasFields({ voiceover: "always", subtitles: true }),
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
            "Animates each composite into a 3-second clip, then joins them with ffmpeg. Clips are generated silent — the voiceover and music are laid on afterwards.",
        },
      ],
    },
    optionalExtrasSection({
      voiceoverAlways: true,
      voiceoverBlurb:
        "Reads your Script aloud, in one take, before anything is drawn. Its length sets how many shots there are — one for every 3 seconds.",
      subtitlesBlurb:
        "Word-by-word captions transcribed from the voiceover and burned in. They are the only text on the video, and they are on unless you switch them off.",
    }),
    BRANDING_SECTION,
  ],

  /**
   * Two gates -- the cast, then the shot list -- which is why porting this
   * early was worth it: the approval step type it forces is the same one
   * Product Spokesperson needs later. There is no story gate any more: the
   * script is the person's own, or is written from their idea, and is recorded
   * before anything is drawn.
   *
   * "stitch" joins the clips, lays the voiceover across them and mixes in the
   * music bed in one ffmpeg invocation, so a second declared step would
   * describe two things happening when only one encode actually runs. Bookend
   * frames and the branded cards fold into it for the same reason.
   *
   * Voice, music, upscale and subtitles are conditional. Order after the
   * stitch is deliberate: subtitles come last, because burning them in
   * before an upscale would upscale the text too.
   */
  pipeline: [
    // The voiceover leads: it is recorded first and the rest is cut to it.
    { id: "voice", primitive: "P4", label: "Record the voiceover" },
    { id: "characters", primitive: "P2", label: "Design characters and backgrounds", gate: true },
    { id: "shots", primitive: "P1", label: "Plan a shot for every 3 seconds", gate: true },
    { id: "scenes", primitive: "P2", label: "Composite each scene" },
    { id: "clips", primitive: "P3", label: "Animate each shot" },
    {
      id: "music",
      primitive: "P4",
      label: "Score the video",
      when: { field: "backgroundMusic", is: "present" },
    },
    { id: "stitch", primitive: "P7", label: "Stitch and mux" },
    {
      id: "upscale",
      primitive: "P3",
      label: "Upscale the video",
      when: { field: "videoUpscale", is: "present" },
    },
    {
      id: "subtitles",
      primitive: "P8",
      label: "Burn in captions",
      when: { field: "subtitles", is: "present" },
    },
  ],
});
