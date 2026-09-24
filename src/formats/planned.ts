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

// Slideshow moved out to formats/slideshow.ts once it grew real pipeline
// options -- the same move this file's header describes for every format that
// outgrows a bare declaration.

// Wall of Text moved out to formats/wallOfText.ts once it gained a real video,
// audio and a studio gate.

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

// Video Animation moved out to formats/videoAnimation.ts once its config grew the
// Advanced block -- the same move Slideshow made.

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
    captionOverlay: field.captionOverlay(),
    captionStyle: field.captionStyle(),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Render the avatar" },
    {
      id: "captions",
      primitive: "P8",
      label: "Burn in captions",
      when: { field: "captionOverlay", is: "present" },
    },
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
    captionOverlay: field.captionOverlay(),
    captionStyle: field.captionStyle(),
    prompt: field.prompt(),
    script: field.longText({ label: "Script", optional: true, generatedBy: "P1" }),
  },
  pipeline: [
    { id: "composite", primitive: "P2", label: "Create spokesperson image", gate: true },
    { id: "copy", primitive: "P1", label: "Write the script", when: { field: "script", is: "empty" } },
    { id: "speech", primitive: "P4", label: "Generate the voice" },
    { id: "avatar", primitive: "P5", label: "Animate the spokesperson" },
    {
      id: "captions",
      primitive: "P8",
      label: "Burn in captions",
      when: { field: "captionOverlay", is: "present" },
    },
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
    // The earlier FLAG here guessed at "Audio" as a three-way music/sound/
    // silent choice. The updated spec settles it: pick a clip or upload one.
    audio: field.audioClip(),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    videoModel: field.videoModel(),
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
 * Claymation and Skeleton had byte-identical config lists in the spec --
 * same six fields, same four style options, same five caption styles -- and
 * shared this config until Skeleton was rebuilt around the client's own
 * reference clips (see `skeleton` below). Claymation, Lego, Felt and Talking
 * Objects still differ by one art-direction constant.
 */
const clayLikeConfig = {
  productImage: field.image({
    label: "Product image",
    optional: true,
    help: "Optional. With one, it is placed into the scene as it is. Without one, the scene is drawn from your prompt.",
  }),
  duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
  language: field.language(),
  style: field.choice({
    label: "Style",
    options: ["Educational", "Problem > Solution", "Storytime", "UGC Hook"],
    default: "Educational",
  }),
  videoModel: field.videoModel(),
  captionOverlay: field.captionOverlay(),
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
  {
    id: "captions",
    primitive: "P8" as const,
    label: "Burn in captions",
    when: { field: "captionOverlay", is: "present" } as const,
  },
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

/**
 * A photoreal skeleton is the main character and acts the topic out, one
 * short cinematic shot per line of narration -- rebuilt on 19 Sept 2026 to
 * match the client's reference clips (see convex/skeleton.ts). The product
 * became an optional prop rather than the focal point, and the character is
 * pickable: left empty, it's a default skeleton with no branding.
 */
export const skeleton = defineFormat({
  id: "skeleton",
  name: "Skeleton",
  blurb: "A skeleton acts out your topic in cinematic shots, with narration and captions",
  icon: "💀",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 5,
  config: {
    character: field.avatar({
      label: "Character",
      optional: true,
      help: "Optional. Leave it on the default skeleton, or cast your own character.",
      default: undefined,
      emptyLabel: "The default skeleton",
      casting: false,
    }),
    productImage: field.image({
      label: "Product image",
      optional: true,
      help: "Optional. The skeleton uses it as a prop where it fits.",
    }),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    language: field.language(),
    style: clayLikeConfig.style,
    videoModel: field.videoModel(),
    captionOverlay: field.captionOverlay(),
    captionStyle: field.captionStyle(),
    narration: field.longText({ label: "Narration", optional: true, generatedBy: "P1" }),
    prompt: field.prompt(),
  },
  // Always plans: even hand-written narration needs splitting into shots.
  pipeline: [
    { id: "copy", primitive: "P1", label: "Write the story and break it into shots" },
    { id: "scene", primitive: "P2", label: "Stage each shot" },
    { id: "clip", primitive: "P3", label: "Animate each shot" },
    { id: "speech", primitive: "P4", label: "Record the narration" },
    {
      id: "captions",
      primitive: "P8",
      label: "Burn in captions",
      when: { field: "captionOverlay", is: "present" },
    },
  ],
});

// ---------------------------------------------------------------- Phase 6

export const characterSwap = defineFormat({
  id: "character-swap",
  name: "Character Swap",
  blurb: "Swap the character in a video using AI",
  icon: "🔄",
  group: "swap-custom",
  preview: "video",
  status: "ready",
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

// ---------------------------------------------------------------- Phase 7
//
// The seven formats added by the updated spec. Every one is `planned` rather
// than `ready`: "ready" means the step runners for its pipeline exist, and
// none of these have a starter in convex/starters.ts yet. They show in the
// picker from day one -- a visible roadmap beats a hidden one -- but can't be
// entered until their runners land.

/**
 * On a Walk, Netflix Documentary and Cutting Fruit are the same format with
 * three art directions: a generated scene of someone talking, with the user's
 * text over it. Written out rather than folded into a shared config so the
 * existing Cutting Fruit declaration stays untouched.
 */
const spokenSceneStyle = () =>
  field.choice({
    label: "Style",
    options: ["Ranting", "Quick Thought", "Storytime", "Advice", "Not sure"],
    default: "Not sure",
  });

const spokenScenePipeline = (sceneLabel: string) => [
  { id: "copy", primitive: "P1" as const, label: "Write the narration" },
  { id: "speech", primitive: "P4" as const, label: "Record the narration" },
  { id: "scene", primitive: "P2" as const, label: sceneLabel },
  { id: "clip", primitive: "P3" as const, label: "Animate the scene" },
  { id: "captions", primitive: "P8" as const, label: "Burn in captions" },
];

export const onAWalk = defineFormat({
  id: "on-a-walk",
  name: "On a Walk",
  blurb: "Your text over a generated walking selfie",
  icon: "🚶",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: {
    mentionBusiness: field.mentionBusiness(),
    whosWalking: field.avatar({ label: "Who's walking" }),
    audio: field.audioClip(),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    videoModel: field.videoModel(),
    style: spokenSceneStyle(),
    prompt: field.prompt(),
  },
  pipeline: spokenScenePipeline("Generate the walking selfie"),
});

export const netflixDocumentary = defineFormat({
  id: "netflix-documentary",
  name: "Netflix Documentary",
  blurb: "Your text over a generated interview clip",
  icon: "🎬",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: {
    mentionBusiness: field.mentionBusiness(),
    whosOnCamera: field.avatar({ label: "Who's on camera" }),
    audio: field.audioClip(),
    duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
    videoModel: field.videoModel(),
    style: spokenSceneStyle(),
    prompt: field.prompt(),
  },
  pipeline: spokenScenePipeline("Generate the interview scene"),
});

/** Lego is Claymation with different bricks -- same config list, same steps. */
export const lego = defineFormat({
  id: "lego",
  name: "Lego",
  blurb: "Stop-motion Lego brick ad with narration and captions",
  icon: "🟦",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: clayLikeConfig,
  pipeline: clayLikePipeline("LEGO_STYLE"),
});

/**
 * Felt and Talking Objects share the spec's second style vocabulary -- the
 * blunt one -- where Claymation, Lego and Skeleton share the explainer one.
 * Otherwise identical to the clay-like config.
 */
const bluntStyleConfig = {
  ...clayLikeConfig,
  style: field.choice({
    label: "Style",
    // "Tough-love", not the spec's "touch-love" -- reading that as a typo
    // rather than inventing a fifth tone.
    options: ["Aggressive rant", "Tough-love callout", "Blunt warning", "No-nonsense explainer"],
    default: "No-nonsense explainer",
  }),
};

export const felt = defineFormat({
  id: "felt",
  name: "Felt",
  blurb: "Stop-motion felt ad with narration and captions",
  icon: "🧶",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: bluntStyleConfig,
  pipeline: clayLikePipeline("FELT_STYLE"),
});

export const talkingObjects = defineFormat({
  id: "talking-objects",
  name: "Talking Objects",
  blurb: "A niche object talks straight at the viewer to drive the point home",
  icon: "🗿",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: bluntStyleConfig,
  pipeline: clayLikePipeline("TALKING_OBJECT_STYLE"),
});

/**
 * Street Interview and AI News Anchor are the first two formats to name a
 * brand directly rather than through the "Mention your business?" toggle --
 * the brand name is the subject of the piece, not a mention bolted onto it.
 */
const broadcastConfig = {
  productImage: field.image({ label: "Product image" }),
  brandName: field.shortText({ label: "Brand name" }),
  duration: field.seconds({ label: "Duration", min: 3, max: 60, default: 30 }),
  language: field.language(),
  videoModel: field.videoModel(),
  captionOverlay: field.captionOverlay(),
  captionStyle: field.captionStyle(),
  // FLAG: same gap as clayLikeConfig's `narration` -- a P1-generated script
  // field needs a topic to generate it FROM. Fixed the same way here.
  prompt: field.prompt(),
};

/**
 * Unlike `spokenScenePipeline` (whose "copy" step is unconditional, because
 * On a Walk and Netflix Documentary have no way to write their own narration),
 * Street Interview and AI News Anchor's own script field IS optional -- so
 * the write-it-for-me step needs the same skip-when-filled-in condition
 * `clayLikePipeline` already uses.
 */
const broadcastScenePipeline = (sceneLabel: string, textField: string) => [
  { id: "copy", primitive: "P1" as const, label: "Write the script", when: { field: textField, is: "empty" } as const },
  { id: "speech", primitive: "P4" as const, label: "Record the audio" },
  { id: "scene", primitive: "P2" as const, label: sceneLabel },
  { id: "clip", primitive: "P3" as const, label: "Animate the scene" },
  {
    id: "captions",
    primitive: "P8" as const,
    label: "Burn in captions",
    when: { field: "captionOverlay", is: "present" } as const,
  },
];

export const streetInterview = defineFormat({
  id: "street-interview",
  name: "Street Interview",
  blurb: "Impromptu street vox-pop that looks like unedited iPhone footage",
  icon: "🎤",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: {
    ...broadcastConfig,
    style: field.choice({
      label: "Style",
      options: [
        "Solo, mic only",
        "Multiple, mic only",
        "Solo, both in frame",
        "Multiple, both in frame",
      ],
      default: "Solo, mic only",
    }),
    dialogue: field.longText({
      label: "Dialogue",
      optional: true,
      generatedBy: "P1",
      help: "36-49 words. Left empty, it gets written for you.",
    }),
  },
  pipeline: broadcastScenePipeline("Generate the street scene", "dialogue"),
});

export const aiNewsAnchor = defineFormat({
  id: "ai-news-anchor",
  name: "AI News Anchor",
  blurb: "A news anchor breaks your customer's problem as tonight's top story",
  icon: "📺",
  group: "generated",
  preview: "video",
  status: "ready",
  phase: 7,
  config: {
    ...broadcastConfig,
    style: field.choice({
      label: "Style",
      options: ["News desk close", "News desk wide", "Late bulletin, dark studio"],
      default: "News desk close",
    }),
    newsItem: field.longText({
      label: "News item",
      optional: true,
      generatedBy: "P1",
      help: "32-42 words. Left empty, it gets written for you.",
    }),
  },
  pipeline: broadcastScenePipeline("Generate the news studio", "newsItem"),
});
