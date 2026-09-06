import { defineFormat } from "./types";
import { field } from "./fields";

/**
 * The fifteen formats whose step runners don't exist yet.
 *
 * They live together while they're declarations only; each one moves to its
 * own file (formats/claymation.ts, and so on) when its phase arrives and it
 * gains real pipeline options. They are listed in the picker from day one --
 * the registry lists itself, and a visible roadmap beats a hidden one -- but
 * are marked `planned`, so the picker shows the phase instead of letting you
 * in.
 *
 * Config fields follow the spec of 6 Sept 2026 exactly. Where that spec was
 * ambiguous, the field carries a FLAG comment rather than an invention.
 */

// ---------------------------------------------------------------- Phase 1

export const slideshow = defineFormat({
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
      options: ["Pixar 3D", "Anime", "Watercolor", "Photorealistic", "Claymation"],
      default: "Photorealistic",
    }),
    prompt: field.prompt(),
  },
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the captions" },
    { id: "images", primitive: "P2", label: "Generate slide images" },
    { id: "render", primitive: "P8", label: "Assemble with captions" },
  ],
});

export const wallOfText = defineFormat({
  id: "wall-of-text",
  name: "Wall of Text",
  blurb: "Bold text on a plain background",
  icon: "🔠",
  group: "slides-text",
  preview: "video",
  status: "ready",
  phase: 1,
  config: {
    text: field.longText({
      label: "Text",
      optional: true,
      generatedBy: "P1",
      placeholder: "One idea, under 140 characters.",
      help: "Write it yourself, or leave blank and give a prompt below.",
    }),
    prompt: field.longText({
      label: "Prompt",
      optional: true,
      placeholder: "What should it say? Only used when Text is blank.",
    }),
    captionStyle: field.captionStyle({ default: "Headline" }),
    backgroundColor: field.choice({
      label: "Background",
      options: ["#111111", "#0f1a2e", "#1c1917", "#14532d", "#7f1d1d"],
      default: "#111111",
    }),
    dimensions: field.choice({
      label: "Dimensions",
      options: ["9:16", "1:1", "4:5", "16:9"],
      default: "9:16",
    }),
    durationSec: field.seconds({ label: "Duration", min: 1, max: 60, default: 5 }),
    mentionBusiness: field.mentionBusiness(),
  },
  /**
   * FLAG, still open: the spec adds a Trending video to this format while the
   * blurb says plain background. Planned as a background choice, with the clip
   * option arriving in Phase 3 when the library exists. Shipping the plain
   * version now costs nothing and does not prejudge the answer.
   */
  pipeline: [
    // Skipped entirely when the text is written by hand, which is what makes
    // this format runnable with no model access at all.
    {
      id: "copy",
      primitive: "P1",
      label: "Write the text",
      when: { field: "text", is: "empty" },
    },
    { id: "render", primitive: "P8", label: "Typeset and render" },
  ],
});

export const custom = defineFormat({
  id: "custom",
  name: "Custom",
  blurb: "Upload your own video or image",
  icon: "🧩",
  group: "swap-custom",
  preview: "video",
  status: "ready",
  phase: 1,
  config: {
    sourceAssetId: field.video({ label: "Video or image" }),
    dimensions: field.choice({
      label: "Dimensions",
      options: ["9:16", "1:1", "4:5", "16:9"],
      default: "9:16",
    }),
    fit: field.choice({
      label: "Framing",
      options: ["Fit (letterbox)", "Fill (crop)"],
      default: "Fit (letterbox)",
      help: "Fit keeps the whole upload. Fill crops the edges to fill the frame.",
    }),
    durationSec: field.seconds({
      label: "Duration",
      min: 1,
      max: 60,
      default: 5,
      help: "Used for still images. A video keeps its own length.",
    }),
    text: field.longText({ label: "Text", optional: true }),
    captionStyle: field.captionStyle(),
    captionPosition: field.choice({
      label: "Text position",
      options: ["bottom", "center", "top"],
      default: "bottom",
    }),
    overlayAssetId: field.image({ label: "Overlay", optional: true }),
  },
  // No model calls at all -- this one exists to exercise the render service.
  // Composite and type land on the same ffmpeg invocation, so it is one step
  // rather than two: splitting them would re-encode an intermediate for nothing.
  pipeline: [
    { id: "composite", primitive: "P7", label: "Compose and caption" },
  ],
});

// ---------------------------------------------------------------- Phase 2

export const videoAnimation = defineFormat({
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
      options: ["Pixar 3D", "Anime", "Watercolor", "Photorealistic", "Claymation"],
      default: "Pixar 3D",
    }),
    aspectRatio: field.choice({
      label: "Aspect ratio",
      options: ["16:9", "9:16", "1:1", "4:5"],
      default: "16:9",
    }),
    language: field.language(),
    mentionBusiness: field.mentionBusiness(),
  },
  /**
   * Three gates, which is why porting this early is worth it: the approval
   * step type it forces is the same one Product Spokesperson needs in Phase 4.
   *
   * "stitch" absorbs what would have been a separate "captions" step -- same
   * reasoning as Custom's composite step: burning captions in is the same
   * ffmpeg invocation as the mux, so a second declared step would describe
   * two things happening when only one encode actually runs.
   */
  pipeline: [
    { id: "story", primitive: "P1", label: "Write the story", gate: true },
    { id: "characters", primitive: "P2", label: "Design characters and backgrounds", gate: true },
    { id: "shots", primitive: "P1", label: "Build the shot list", gate: true },
    { id: "scenes", primitive: "P2", label: "Composite each scene" },
    { id: "clips", primitive: "P3", label: "Animate each shot" },
    { id: "voice", primitive: "P4", label: "Record voiceover" },
    { id: "stitch", primitive: "P7", label: "Stitch, caption and mux" },
  ],
});

// ---------------------------------------------------------------- Phase 3

export const videoHookDemo = defineFormat({
  id: "video-hook-demo",
  name: "Video Hook & Demo",
  blurb: "Hook clip + app demo stitched together",
  icon: "🪝",
  group: "trending",
  preview: "video",
  status: "ready",
  phase: 3,
  config: {
    mode: field.mode(),
    mentionBusiness: field.mentionBusiness(),
    trendingClip: field.trendingClip(),
    demoVideo: field.video({ label: "Demo video" }),
    prompt: field.prompt(),
  },
  /**
   * "Stitch" absorbs the caption burn-in -- same reasoning as Video
   * Animation's "stitch" step: both happen in one ffmpeg encode, so a second
   * declared step would describe two things happening when only one render
   * actually runs.
   */
  pipeline: [
    { id: "clip", primitive: "P9", label: "Fetch the hook clip" },
    { id: "copy", primitive: "P1", label: "Write the captions" },
    { id: "stitch", primitive: "P7", label: "Stitch hook onto demo and caption" },
  ],
});

export const greenScreenMeme = defineFormat({
  id: "green-screen-meme",
  name: "Green Screen Meme",
  blurb: "Trending video with your background image",
  icon: "🟩",
  group: "trending",
  preview: "video",
  status: "ready",
  phase: 3,
  config: {
    mode: field.mode(),
    mentionBusiness: field.mentionBusiness(),
    trendingClip: field.trendingClip(),
    background: field.image({ label: "Background image" }),
    prompt: field.prompt(),
  },
  pipeline: [
    { id: "clip", primitive: "P9", label: "Fetch the clip" },
    { id: "copy", primitive: "P1", label: "Write the captions" },
    { id: "key", primitive: "P7", label: "Chroma key, composite and caption" },
  ],
});

// ---------------------------------------------------------------- Phase 4

export const talkingHeadUgc = defineFormat({
  id: "talking-head-ugc",
  name: "Talking Head UGC",
  blurb: "AI avatar speaks a script to camera",
  icon: "🗣️",
  group: "avatars",
  preview: "video",
  status: "ready",
  phase: 4,
  // FLAG: the spec named no avatar picker and no separate topic field, yet
  // declares a P5 avatar step and a P1 step that generates "script" from
  // something -- neither is possible without them. Added both rather than
  // block; nothing else invented.
  config: {
    mode: field.mode(),
    avatar: field.avatar({ label: "AI influencer" }),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    language: field.language(),
    captionStyle: field.captionStyle(),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Render the avatar" },
    { id: "captions", primitive: "P8", label: "Burn in captions" },
  ],
});

export const speakingHookDemo = defineFormat({
  id: "speaking-hook-demo",
  name: "Speaking Hook & Demo",
  blurb: "Someone says the hook out loud, then your demo",
  icon: "📣",
  group: "avatars",
  preview: "video",
  status: "ready",
  phase: 4,
  // FLAG: no avatar picker in the spec's list despite a P5 step -- added,
  // same reasoning as Talking Head UGC. "Hook" already supplies P1 its topic,
  // so no extra prompt field is needed here.
  config: {
    speaker: field.avatar({ label: "Speaker" }),
    hook: field.shortText({ label: "Hook" }),
    demoVideo: field.video({ label: "Demo video" }),
    language: field.language(),
    saying: field.longText({ label: "What they say", optional: true, generatedBy: "P1" }),
    captionStyle: field.captionStyle(),
    delivery: field.choice({
      label: "How they say it",
      options: ["Auto", "Shocked", "Outrage", "Realizing", "Relieved", "Deadpan"],
      default: "Auto",
    }),
    mentionBusiness: field.mentionBusiness(),
  },
  /**
   * "Stitch" absorbs the caption burn-in, same reasoning as every other
   * format that combines them: one ffmpeg encode, one declared step.
   */
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the hook", when: { field: "saying", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Render the speaker" },
    { id: "stitch", primitive: "P7", label: "Stitch onto the demo and caption" },
  ],
});

export const talkingHeadGreenScreen = defineFormat({
  id: "talking-head-green-screen",
  name: "Talking Head Green Screen",
  blurb: "AI avatar composited into the corner of a demo video",
  icon: "👤",
  group: "avatars",
  preview: "video",
  status: "ready",
  phase: 4,
  // FLAG: the spec's config list opens with the format's own name where a
  // field should be, and names no topic field for the P1 step. The missing
  // slot is most likely Mode or Caption style; added a Prompt field for P1
  // to generate from, same reasoning as Talking Head UGC. Nothing else
  // invented.
  config: {
    demoVideo: field.video({ label: "Demo video" }),
    avatar: field.avatar({ label: "Avatar" }),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Render the avatar" },
    { id: "pip", primitive: "P7", label: "Key, place picture-in-picture and caption" },
  ],
});

export const productSpokesperson = defineFormat({
  id: "product-spokesperson",
  name: "Product Spokesperson",
  blurb: "A character holds your product and talks about it",
  icon: "🎁",
  group: "avatars",
  preview: "image", // stops on the still until you approve it
  status: "ready",
  phase: 4,
  // FLAG: added a Prompt field, same reasoning as Talking Head UGC -- P1
  // needs a topic to write the script from when the field is left empty.
  config: {
    // Step 1 -- create the spokesperson image
    avatar: field.avatar({ label: "Avatar" }),
    productImage: field.image({ label: "Product image" }),
    // Step 2 -- generate the video
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    language: field.language(),
    captionStyle: field.captionStyle(),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "composite", primitive: "P2", label: "Create spokesperson image", gate: true },
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Animate the spokesperson" },
    { id: "captions", primitive: "P8", label: "Burn in captions" },
  ],
});

export const greenScreenMobile = defineFormat({
  id: "green-screen-mobile",
  name: "Green Screen Mobile with App",
  blurb: "A presenter holding a phone with your app on screen",
  icon: "📱",
  group: "avatars",
  preview: "video",
  status: "ready",
  phase: 4,
  // FLAG: added a Prompt field, same reasoning as Talking Head UGC.
  config: {
    appScreenshot: field.image({ label: "App screenshot" }),
    presenter: field.avatar({ label: "Presenter" }),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "composite", primitive: "P2", label: "Place the app on the phone" },
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Render the presenter" },
    { id: "captions", primitive: "P8", label: "Burn in captions" },
  ],
});

// ---------------------------------------------------------------- Phase 5

export const cuttingFruit = defineFormat({
  id: "cutting-fruit",
  name: "Cutting Fruit",
  blurb: "Your text over a generated kitchen clip",
  icon: "🍉",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 5,
  config: {
    mentionBusiness: field.mentionBusiness(),
    whosCutting: field.avatar({ label: "Who's cutting" }),
    // FLAG: "Audio" has three plausible readings. Planned as a music bed plus
    // a sound toggle -- the only reading that doesn't duplicate narration
    // controls this format doesn't have.
    audio: field.choice({
      label: "Audio",
      options: ["Music bed", "Kitchen sound", "Silent"],
      default: "Music bed",
    }),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    style: field.choice({
      label: "Style",
      options: ["Ranting", "Quick Thought", "Storytime", "Advice", "Not sure"],
      default: "Not sure",
    }),
    prompt: field.prompt(),
  },
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the narration" },
    { id: "speech", primitive: "P4", label: "Record the narration" },
    { id: "scene", primitive: "P2", label: "Generate the kitchen scene" },
    { id: "clip", primitive: "P3", label: "Animate the scene" },
    { id: "captions", primitive: "P8", label: "Burn in captions" },
  ],
});

/**
 * Claymation and Skeleton have byte-identical config lists in the spec --
 * same six fields, same four style options, same five caption styles. They
 * differ by one art-direction constant, which is exactly the bet the registry
 * was built on. Keep them that way.
 */
const clayLikeConfig = {
  productImage: { ...field.image({ label: "Product image" }) },
  duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
  language: field.language(),
  style: field.choice({
    label: "Style",
    options: ["Educational", "Problem > Solution", "Storytime", "UGC Hook"],
    default: "Educational",
  }),
  captionStyle: field.captionStyle(),
  narration: field.longText({ label: "Narration", optional: true, generatedBy: "P1" }),
  // FLAG: the spec gives this format a P1-generated narration field but no
  // topic to generate it FROM -- the same gap already found and fixed this
  // way for four avatar formats in Phase 4.
  prompt: field.prompt(),
};

const clayLikePipeline = (artDirection: string) => [
  { id: "copy", primitive: "P1" as const, label: "Write the narration", when: { field: "narration", is: "empty" } as const },
  { id: "speech", primitive: "P4" as const, label: "Record the narration" },
  { id: "scene", primitive: "P2" as const, label: "Generate the scene", options: { artDirection } },
  { id: "clip", primitive: "P3" as const, label: "Animate the scene" },
  { id: "captions", primitive: "P8" as const, label: "Burn in captions" },
];

export const claymation = defineFormat({
  id: "claymation",
  name: "Claymation",
  blurb: "Stop-motion clay ad with narration and captions",
  icon: "🧱",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 5,
  config: clayLikeConfig,
  pipeline: clayLikePipeline("CLAY_STYLE"),
});

export const skeleton = defineFormat({
  id: "skeleton",
  name: "Skeleton",
  blurb: "Educational skeleton video with narration and captions",
  icon: "💀",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 5,
  config: clayLikeConfig,
  pipeline: clayLikePipeline("SKELETON_STYLE"),
});

// ---------------------------------------------------------------- Phase 6

export const characterSwap = defineFormat({
  id: "character-swap",
  name: "Character Swap",
  blurb: "Swap the character in a video using AI",
  icon: "🔄",
  group: "swap-custom",
  preview: "video",
  status: "planned",
  phase: 6,
  config: {
    sourceVideo: field.video({ label: "Source video" }),
    characterImage: field.image({ label: "Character image" }),
    sceneControl: field.choice({
      label: "Scene control",
      options: ["Video", "Image", "Recreate"],
      default: "Image",
      help:
        "Video (3-15s) keeps the clip's background and motion. Image (3-30s) keeps your " +
        "character image's background -- most reliable. Recreate (3-30s) puts your character " +
        "into the clip's first frame, best for close-ups on a still background.",
    }),
    audio: field.choice({
      label: "Audio",
      options: ["Strip the audio", "Keep the original sound", "Convert the voice to the character"],
      default: "Keep the original sound",
    }),
  },
  pipeline: [
    { id: "swap", primitive: "P6", label: "Swap the character" },
    {
      id: "voice",
      primitive: "P4",
      label: "Convert the voice",
      when: { field: "audio", equals: "Convert the voice to the character" },
    },
    // The spec's own rule: if the character isn't swapped, detect it and don't
    // charge. That needs a reversal entry in the ledger, not a manual credit.
    { id: "verify", primitive: "P7", label: "Verify the swap took" },
  ],
});
