import { defineFormat } from "./types";
import { ASPECT_RATIOS, field } from "./fields";
import { BRANDING_SECTION, extrasFields, optionalExtrasSection } from "./extras";

/**
 * Slideshow: generated stills, Ken Burns, a caption a slide -- and, behind
 * one collapsed block, the whole production line the old app kept on a
 * separate settings page.
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
  blurb: "Multi-image carousel with captions",
  icon: "🖼️",
  group: "slides-text",
  preview: "video",
  shipsToday: true, // the old app's Image Slideshow mode
  status: "ready",
  phase: 1,

  config: {
    mode: field.mode(),
    mentionBusiness: field.mentionBusiness(),
    images: field.count({ label: "Images", min: 3, max: 20, default: 10 }),
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
      help: "Reference images, in order. The captions are written around them as Character 1, 2, 3… so the story can call for whoever a slide needs. Leave empty and the characters are designed from your prompt and drawn for you.",
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
    // Animation -- see extras.ts.
    ...extrasFields({ voiceover: false }),
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
      voiceoverBlurb:
        "Reads each slide's caption aloud. A slide then stays up for as long as its line takes.",
      subtitlesBlurb:
        "Word-by-word captions transcribed from the voiceover, burned in over the slide captions.",
    }),
    BRANDING_SECTION,
  ],

  /**
   * Five of the eight steps are conditional, which is what makes the advanced
   * block worth having: a default slideshow still runs copy -> images ->
   * render and costs what it always did.
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
    { id: "copy", primitive: "P1", label: "Write the captions" },
    { id: "images", primitive: "P2", label: "Generate slide images" },
    {
      id: "composite",
      primitive: "P2",
      label: "Place your characters in each slide",
      when: { field: "compositeScenes", is: "present" },
    },
    {
      id: "voice",
      primitive: "P4",
      label: "Record the voiceover",
      when: { field: "voiceover", is: "present" },
    },
    {
      id: "music",
      primitive: "P4",
      label: "Score the slideshow",
      when: { field: "backgroundMusic", is: "present" },
    },
    { id: "render", primitive: "P8", label: "Assemble with captions" },
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
