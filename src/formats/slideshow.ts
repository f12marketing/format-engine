import { defineFormat } from "./types";
import { ASPECT_RATIOS, field } from "./fields";
import { BRANDING_SECTION, extrasFields, optionalExtrasSection } from "./extras";
import { SCRIPT_MAX_CHARS } from "../../convex/lib/scriptTiming";

/**
 * Slideshow: a script, spoken, with a generated still on screen for every
 * three seconds of it -- and, behind one collapsed block, the whole production
 * line the old app kept on a separate settings page.
 *
 * The video is cut to its voiceover. The script is recorded first; however
 * long that takes (X seconds) becomes X / 3 slides. So there is no slide count
 * and no length to choose -- both come from the script.
 *
 * Moving those seven model cards into the format's own config is the point.
 * In the old app they were global: a setting changed for one video changed it
 * for every video, and the run that shipped kept no record of what it was set
 * to. Here they are part of the config snapshot `run.generate` freezes onto
 * the job, so two slideshows can disagree about voiceover and both still be
 * explainable six weeks later.
 *
 * Option labels below are read verbatim by convex/slideshow.ts -- rename one
 * there too, or the server falls back to its default.
 */
export default defineFormat({
  id: "slideshow",
  name: "Slideshow",
  blurb: "Script, voiceover and a new image every 3 seconds, with subtitles",
  icon: "🖼️",
  group: "slides-text",
  preview: "video",
  shipsToday: true, // the old app's Image Slideshow mode
  status: "ready",
  phase: 1,

  config: {
    /**
     * The words the voiceover speaks, and the whole of the video's timing. It
     * is recorded first; its length divided by three is the slide count, and
     * each slide is planned around the words spoken while it is on screen
     * (convex/lib/scriptTiming.ts). Required: it is the video's only source of
     * length, so nobody is ever asked how long the video should be.
     */
    script: field.longText({
      label: "Script",
      required: true,
      maxLength: SCRIPT_MAX_CHARS,
      rows: 7,
      placeholder: "The words you want spoken, e.g. a short story or a few tips.",
      help: "Recorded as the voiceover first. Each slide then stays up for 3 seconds, so a 60-second script becomes 20 slides.",
    }),
    mentionBusiness: field.mentionBusiness(),
    style: field.choice({
      label: "Style",
      options: [
        "Pixar 3D",
        "Anime",
        "Watercolor",
        "Photorealistic",
        "Hyper-realistic",
        "Claymation",
      ],
      default: "Photorealistic",
    }),
    aspectRatio: field.choice({
      label: "Aspect ratio",
      options: ASPECT_RATIOS,
      default: "9:16 — Instagram Reels & Stories",
      help: "Sets the frame the slides are generated at and the video is cut to.",
    }),
    prompt: field.prompt(),

    /**
     * The old app's bookend frames, from its dashboard rather than its
     * settings page. Video only, and deliberately so -- these are spliced
     * onto the timeline as their own segments, so a still has no duration to
     * splice.
     */
    startFrameAssetId: field.video({
      label: "Start frame",
      optional: true,
      videoOnly: true,
      help: "Plays before the slideshow. Video files only.",
    }),
    endFrameAssetId: field.video({
      label: "End frame",
      optional: true,
      videoOnly: true,
      help: "Plays after the slideshow. Video files only.",
    }),

    // ---------------------------------------- Character & Background Images
    // The `images` step already calls nano-banana-2; these are its knobs.
    // The old card's two aspect-ratio dropdowns are gone on purpose: a
    // slideshow has one frame, and it is the Aspect ratio field above.
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
    /**
     * The old card blends a background plate with a shot's characters. A
     * slideshow has no plates, but it has the same underlying problem the
     * moment the deck is a STORY: a cast that has to stay recognisable from
     * slide 1 to slide 10, rather than ten unrelated renders of a
     * description.
     *
     * So this takes a cast, not a subject. Each reference is named by its
     * position ("Character 1") in both the planning prompt and the edit
     * prompt, which is how Drama keeps a face consistent across a storyboard
     * -- see convex/drama.ts's drawStoryboard. A single product shot is just
     * the one-character case.
     *
     * Uploading is optional. With none, the writer designs the cast from the
     * prompt and each character is drawn as a reference image first, the way
     * the story-to-animation app makes characters nobody supplied.
     */
    compositeScenes: field.toggle({
      label: "Composite scenes",
      default: false,
      advanced: true,
      group: "Composite Scenes",
    }),
    compositeReferenceAssetIds: field.images({
      label: "Characters / subjects",
      optional: true,
      maxItems: 4,
      advanced: true,
      group: "Composite Scenes",
      showWhen: { field: "compositeScenes", is: "present" },
      help: "Reference images, in order. The slides are planned around them as Character 1, 2, 3… so the story can call for whoever a slide needs. Leave empty and the characters are designed from your prompt and drawn for you.",
    }),
    compositeOutputFormat: field.choice({
      label: "Output format",
      options: ["jpeg", "png"],
      default: "jpeg",
      advanced: true,
      group: "Composite Scenes",
      showWhen: { field: "compositeScenes", is: "present" },
    }),

    // Voiceover, music, subtitles, upscale, branding: shared with Video
    // Animation -- see extras.ts. The voiceover is not optional here: it is
    // what the video is cut to.
    ...extrasFields({ voiceover: "always", subtitles: true }),
  },

  /**
   * The old settings page's own grouping, kept: Core pipeline, Optional
   * extras, Branding. A card whose stage can be left out carries its switch
   * in the header (`toggle`), and the fields under it appear only while it
   * is on. The card titles are the `group` on each field above.
   *
   * The page's Video Clips card is absent because a slideshow has no clips --
   * its Ken Burns cut is rendered locally, which is the "free Image
   * Slideshow" branch that card's own description names.
   */
  advancedSections: [
    {
      title: "Core pipeline",
      blurb: "The image generation behind every slide.",
      cards: [
        {
          title: "Character & Background Images",
          model: "fal-ai/nano-banana-2",
          blurb:
            "Generates the slide images — the character and background art for each slide. PNG is lossless; JPEG is smaller.",
        },
        {
          title: "Composite Scenes",
          model: "fal-ai/nano-banana-2/edit",
          blurb:
            "Carries the same characters or product through every slide, instead of regenerating them each time. Upload your own, or leave it empty and they are designed from your prompt.",
          toggle: "compositeScenes",
        },
      ],
    },
    optionalExtrasSection({
      voiceoverAlways: true,
      voiceoverBlurb:
        "Reads your Script aloud, in one take, before anything is drawn. Its length sets how many slides there are — one for every 3 seconds.",
      subtitlesBlurb:
        "Word-by-word subtitles transcribed from the voiceover and burned in. They are the only text on the video, and they are on unless you switch them off.",
    }),
    BRANDING_SECTION,
  ],

  /**
   * The voiceover comes before everything drawn: the video is cut to it. Music,
   * upscale, subtitles and composite are conditional, which is what makes the
   * advanced block worth having.
   *
   * Order is the old pipeline's, and the two places it matters are both
   * deliberate. Bookend frames and brand cards fold into `render` rather than
   * being bolted on afterwards -- one ffmpeg graph, one upload -- so the
   * upscale that follows sees the assembled cut, exactly as
   * worker/pipeline.py ran Topaz after _concat_bookend_frames. Subtitles come
   * last because burning them in before an upscale would upscale the text
   * too, softening the one element that was already pixel-sharp.
   */
  pipeline: [
    // The voiceover leads: it is recorded first and the rest is cut to it.
    { id: "voice", primitive: "P4", label: "Record the voiceover" },
    { id: "copy", primitive: "P1", label: "Plan a slide for every 3 seconds" },
    { id: "images", primitive: "P2", label: "Generate slide images" },
    {
      id: "composite",
      primitive: "P2",
      label: "Place your characters in each slide",
      when: { field: "compositeScenes", is: "present" },
    },
    {
      id: "music",
      primitive: "P4",
      label: "Score the slideshow",
      when: { field: "backgroundMusic", is: "present" },
    },
    { id: "render", primitive: "P8", label: "Assemble the slideshow" },
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
