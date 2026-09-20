import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import {
  callTool,
  LLM_MODEL,
  submitAndPoll,
  submitWithContentPolicyFallback,
} from "./lib/fal";
import { GROUNDING_RULES } from "./lib/grounding";
import { assertVoiceoverSupport, renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import {
  assetUrlOf,
  bookendsAndBranding,
  musicVolumeOf,
  ratioOf,
  scoreMusicStep,
  subtitlesStep,
  upscaleStep,
} from "./lib/extras";
import type { ExtrasConfig } from "./lib/extras";
import { SCENE_SECONDS } from "./lib/scriptTiming";
import { listFrom, narrateScript } from "./lib/scriptVoice";
import type { NarratedScript } from "./lib/scriptVoice";
import { businessContext } from "./lib/businessContext";

/**
 * Slideshow: the format that finally exercises P2 -- and, since the config
 * panel grew an Advanced block, the one that runs the old app's whole
 * production line.
 *
 * Every format before this one either called no model (Custom, Wall of Text)
 * or an LLM only (Carousel). This is the first real image generation --
 * fal-ai/nano-banana-2, ported from the old app's stage_images() -- which
 * makes it the format that proves the P2 primitive rather than just
 * declaring it.
 *
 * Five of the eight steps are optional and read their settings off the job's
 * frozen config rather than a global settings page, which is the point of
 * moving them here: two slideshows can disagree about voiceover and both
 * still be explainable afterwards. Which optional steps exist at all is
 * decided once, at submit, by the pipeline's `when` conditions -- so
 * `plannedStepIds` is the authority below, never a second reading of the
 * config.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const { jobId } = args;
    try {
      // Which optional steps exist is decided once, at submit, by the
      // pipeline's `when` conditions -- so this is the authority, never a
      // second reading of the config.
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId });

      // The video is cut to its voiceover, so the voiceover comes first: the
      // script is recorded, its length (X seconds) becomes X / 3 slides, and
      // only then is anything drawn.
      await step.runAction(internal.slideshow.recordVoiceover, args, { retry: true });
      await step.runAction(internal.slideshow.writePlan, args, { retry: true });
      await step.runAction(internal.slideshow.generateImages, args, { retry: true });

      if (planned.includes("composite")) {
        await step.runAction(internal.slideshow.compositeSubject, args, { retry: true });
      }
      if (planned.includes("music")) {
        await step.runAction(internal.slideshow.scoreMusic, args, { retry: true });
      }

      await step.runAction(internal.slideshow.render, args, { retry: true });

      // Both of these replace the job's output asset with a new one. They run
      // in this order because burning subtitles in first would send the text
      // through Topaz too, softening the one element that was already
      // pixel-sharp.
      if (planned.includes("upscale")) {
        await step.runAction(internal.slideshow.upscale, args, { retry: true });
      }
      if (planned.includes("subtitles")) {
        await step.runAction(internal.slideshow.burnSubtitles, args, { retry: true });
      }

      await step.runMutation(internal.jobs.finish, { jobId, status: "done" });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

// ---------------------------------------------------------------- config

/**
 * The job's frozen config, typed. Every field is optional because a job
 * created before a field existed still has to run.
 */
interface SlideshowConfig extends ExtrasConfig {
  style?: string;
  /**
   * What the voiceover says, word for word. Required. There is no slide count:
   * the script's length decides that.
   */
  script?: string;

  imageOutputFormat?: string;
  imageSafetyTolerance?: string;

  compositeScenes?: boolean;
  compositeReferenceAssetIds?: Id<"assets">[];
  mentionBusiness?: boolean;
  compositeOutputFormat?: string;

  // Voiceover, music, subtitles, upscale and branding settings are the
  // shared ExtrasConfig's -- Video Animation reads the same keys.
}

const DEFAULT_ASPECT_RATIO = "9:16";
const DEFAULT_STYLE = "Photorealistic, cinematic photography, natural lighting";
/** Matches the Characters / subjects field's maxItems, so a designed cast is never bigger than an uploaded one could be. */
const MAX_CAST = 4;

/** See ratioOf: the leading token of the picker's label, checked against the ratios every stage accepts. */
function aspectRatio(config: SlideshowConfig): string {
  return ratioOf(config.aspectRatio, DEFAULT_ASPECT_RATIO);
}

/** Same value for generation as for the cut: nano-banana-2 accepts every ratio this format offers. */
function imageAspectRatio(config: SlideshowConfig): string {
  return aspectRatio(config);
}

// ---------------------------------------------------------------- models and rates

const IMAGE_MODEL = "fal-ai/nano-banana-2";
const IMAGE_PRICE_PER_UNIT = 0.08; // per image at 1K

/**
 * The edit model, and NOT the qwen-image-3/edit the rest of the app
 * composites with.
 *
 * That swap (see the "Model audit" commit) was justified on price, recency
 * and schema compatibility -- "cheaper, newer, identical image_urls/image_size
 * schema" -- and every site it landed on composites ONE subject into ONE
 * frame: an avatar holding a product, a presenter with a phone, a character
 * into a video's first frame. Consistency of a face across many frames was
 * never what it was chosen for.
 *
 * That is exactly what this step needs, and the app has already answered the
 * question once: Drama's storyboard, the only other place a cast has to stay
 * recognisable shot to shot, runs on nano-banana-2/edit or gpt-image-2/edit.
 * nano-banana-2/edit wins here on a detail specific to this format -- it
 * takes `aspect_ratio` directly, while gpt-image-2 needs a size-name map
 * (drama.ts's GPT_IMAGE_SIZE) that has no entry for 4:5 or 3:4, two of the
 * five ratios offered above. It also keeps the edit in the same family as
 * the base generation, so a composited slide and a plain one look like the
 * same deck.
 */
const COMPOSITE_MODEL = "fal-ai/nano-banana-2/edit";
const COMPOSITE_PRICE_PER_UNIT = 0.08; // nano-banana-2 at 1K, flat -- same as generation
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

// ---------------------------------------------------------------- stage 1: the plan (P1)

const SLIDESHOW_SYSTEM = `You plan a short vertical slideshow video: a sequence of generated images,
each on screen for exactly three seconds, cut to a voiceover that is already
recorded. Any words on screen are the voiceover's own captions, added
afterwards -- the slides themselves carry no text.

For each slide, write:
- imagePrompt: what the image shows. Concrete, visual, no text or lettering in
  the image itself -- captions are added separately. One clear subject per
  slide; do not describe a whole scene of unrelated things. End it with a
  short technical tail covering quality and composition, e.g. "photorealistic,
  high detail, no text, no watermark, no UI elements" (adjust the style words
  to match whatever visual style was requested).

The slides together should read as one short narrative arc: an opening that
earns attention, a middle that develops the idea, and a close that lands it --
proportioned to however many slides you were asked for.

${GROUNDING_RULES}`;

const SLIDESHOW_TOOL = {
  name: "save_slideshow",
  description: "Save the slideshow plan.",
  input_schema: {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            imagePrompt: { type: "string" },
          },
          required: ["imagePrompt"],
        },
      },
    },
    required: ["slides"],
  },
};

interface SlidePlan {
  imagePrompt: string;
}

/** A character or subject the writer designed because none were uploaded. */
interface CastMember {
  name: string;
  /** A reference-image prompt, in the deck's visual style. */
  prompt: string;
}

/** A designed cast member once its reference image has been drawn. */
interface DrawnCastMember extends CastMember {
  url: string;
}

/**
 * The same tool, plus a cast when the writer has to design one.
 *
 * `characters` comes first on purpose: the model fills properties in schema
 * order, so it commits to who these people are before it writes the slides
 * that name them.
 */
function slideshowTool(designCast: boolean) {
  if (!designCast) return SLIDESHOW_TOOL;
  return {
    ...SLIDESHOW_TOOL,
    input_schema: {
      ...SLIDESHOW_TOOL.input_schema,
      properties: {
        characters: {
          type: "array",
          maxItems: MAX_CAST,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              prompt: {
                type: "string",
                description: "Image-generation prompt for this character's reference image.",
              },
            },
            required: ["name", "prompt"],
          },
        },
        ...SLIDESHOW_TOOL.input_schema.properties,
      },
      required: ["characters", "slides"],
    },
  };
}

/** The slides out of the planner's tool call, however the model wrapped them (see listFrom). */
function draftedSlides(value: unknown): SlidePlan[] {
  return listFrom<SlidePlan>(value, "slides");
}

/** The voiceover step's output: the script as spoken, how long it ran, and the scene windows. */
function voiceOf(job: { steps: { id: string; output?: unknown }[] }): NarratedScript | undefined {
  return job.steps.find((s) => s.id === "voice")?.output as NarratedScript | undefined;
}

// ---------------------------------------------------------------- stage 1: the voiceover (P4)

/**
 * The whole script in one go, before anything is drawn. How long it takes to
 * say (X seconds) is what decides the slide count (X / 3, rounded up), and the
 * speech model's word timings say which words fall in which slide's three
 * seconds. See lib/scriptTiming.ts.
 */
export const recordVoiceover = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "voice", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SlideshowConfig;

    // Required: it is the video's only source of length. There is no
    // hand-written fallback the way there is for a carousel deck -- with no
    // script there is nothing to say and nothing to size the slideshow by.
    const script = (config.script ?? "").trim();
    if (!script) throw new Error("A script is required.");

    // Before anything is spent: see assertVoiceoverSupport.
    await assertVoiceoverSupport();

    const narrated = await narrateScript(ctx, { jobId, clientId, script, config });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "voice",
      state: "done",
      output: narrated,
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 2: the plan (P1)

export const writePlan = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const config = job.config as SlideshowConfig;
    const subject = (config.prompt ?? "").trim();
    const style = config.style ?? DEFAULT_STYLE;

    // One slide per scene of the voiceover: X / 3, already worked out.
    const voice = voiceOf(job);
    if (!voice?.windows?.length) throw new Error("no voiceover to plan the slides around");
    const count = voice.windows.length;

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: 0.05,
    });

    /**
     * When a cast has been uploaded, the plan is told about it.
     *
     * Without this the writer describes people generically ("a woman at a
     * desk") and the composite step has to guess who that is; with it, a
     * slide's own imagePrompt names Character 2, and the edit call resolves
     * that to a specific uploaded face. This is the difference between a
     * deck that has recurring characters and one that merely has a subject
     * pasted into every frame.
     */
    const castCount = config.compositeScenes
      ? (config.compositeReferenceAssetIds ?? []).length
      : 0;
    const castBrief = castCount
      ? `\n\nThis story has ${castCount} recurring character(s), called ` +
        `${Array.from({ length: castCount }, (_, i) => `Character ${i + 1}`).join(", ")}. ` +
        "Name in each slide's imagePrompt exactly which of them appear in that slide and what " +
        "they are doing -- a slide may feature one, several or none. Refer to them ONLY by those " +
        "names; do not describe their appearance, since they are drawn from reference images."
      : "";

    /**
     * Composite is on but nothing was uploaded: the writer designs the cast.
     *
     * This is the story-to-animation app's move -- extract the characters
     * from the story, write each an image prompt, draw them as reference
     * images that every later frame reuses -- folded into the plan call so a
     * slideshow costs one LLM round trip, not two. The reference images
     * themselves are drawn in compositeSubject.
     */
    const designCast = Boolean(config.compositeScenes) && castCount === 0;
    const designBrief = designCast
      ? "\n\nThis story has recurring characters or subjects -- people, creatures, a product, " +
        "whatever it is about -- that must look identical from slide to slide, and none were " +
        `supplied, so design them yourself. In \`characters\`, list only the ones the story ` +
        `genuinely needs: at most ${MAX_CAST}, usually 1-3. Give each a short \`name\` and a ` +
        "`prompt` for its reference image: for a person or creature, exact appearance (age, " +
        "build, skin tone, hair, eyes, clothing and accessories, colors) in a neutral full-body " +
        "standing pose; for an object, exact shape, materials, colors and markings, whole and " +
        "centered. Plain white background, in this visual style: " +
        `${style}. End it with "soft even lighting, high detail, no text, no watermark". Every ` +
        "later slide is redrawn from this image, so be exact about distinguishing features. " +
        "Then, in each slide's imagePrompt, refer to them ONLY as Character 1, Character 2… in " +
        "the order you listed them: name which appear in that slide and what they are doing -- " +
        "a slide may feature one, several or none -- and do not describe their appearance there."
      : "";

    // The slides are cut to the voiceover: slide i is on screen for exactly
    // three seconds while window i of it is spoken. Each window is the words
    // actually spoken in those seconds, taken from the speech model's timings.
    const windowsBrief =
      "\n\nThe slideshow is cut to a voiceover that is already recorded, and every slide is on " +
      `screen for exactly ${SCENE_SECONDS} seconds while its own part of the script is spoken. ` +
      `The ${count} parts, in order:\n` +
      voice.windows
        .map((w, i) => `${i + 1}. ${w.trim() || "(a pause -- nothing is said)"}`)
        .join("\n") +
      `\n\nWrite exactly ${count} slides, slide 1 for part 1, slide 2 for part 2, and so on. ` +
      "Each imagePrompt shows what is being said in its part (a pause carries the visual thread " +
      "on from the slide before).";

    const call = await callTool(
      SLIDESHOW_SYSTEM,
      `Plan a ${count}-slide slideshow. Visual style: ${style}. ` +
        `Framed ${aspectRatio(config)}.${castBrief}${designBrief}` +
        (subject ? `\n\nSubject:\n\n${subject}` : "") +
        (await businessContext(
          ctx,
          clientId,
          config.mentionBusiness,
          "Where it fits the script, show the business's product, setting or customers in the slides -- never as an ad.",
        )) +
        windowsBrief,
      slideshowTool(designCast) as never,
    );
    const drafted = draftedSlides(call.value);
    if (drafted.length < count) {
      throw new Error(`model returned ${drafted.length} slide(s) for ${count} parts of the script`);
    }
    // One per part, no more: a spare slide would run past the end of the voice.
    const slides: SlidePlan[] = drafted
      .slice(0, count)
      .map((s) => ({ imagePrompt: s.imagePrompt }));

    let characters: CastMember[] | undefined;
    if (designCast) {
      characters = ((call.value as { characters?: CastMember[] })?.characters ?? [])
        .filter((c) => c?.name?.trim() && c?.prompt?.trim())
        .slice(0, MAX_CAST);
      if (!characters.length) {
        throw new Error("Composite scenes needs a cast, but the model designed no characters");
      }
    }

    const costUsd =
      (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M;

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: characters ? { slides, characters } : { slides },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 2: the slides (P2)

/**
 * P2. One nano-banana call per slide, run in parallel -- these are
 * independent images, not a sequence that depends on a prior step's output,
 * so there is nothing to gain from doing them one at a time.
 */
export const generateImages = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "images",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SlideshowConfig;

    const plan = (job.steps.find((s) => s.id === "copy")?.output as
      | { slides?: SlidePlan[] }
      | undefined)?.slides;
    if (!plan?.length) throw new Error("no slide plan to generate images from");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: plan.length * IMAGE_PRICE_PER_UNIT,
    });

    const urls = await Promise.all(
      plan.map(async (slide) => {
        // Same request shape as the old app's stage_images(), with its
        // settings-page knobs now coming off the job's own config.
        const result = (await submitAndPoll(IMAGE_MODEL, {
          prompt: slide.imagePrompt,
          aspect_ratio: imageAspectRatio(config),
          output_format: config.imageOutputFormat ?? "png",
          safety_tolerance: config.imageSafetyTolerance ?? "4",
          num_images: 1,
        })) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no image returned for prompt: ${slide.imagePrompt}`);
        return url;
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "images",
      primitive: "P2",
      model: IMAGE_MODEL,
      units: plan.length,
      unitLabel: "images",
      costUsd: plan.length * IMAGE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "images",
      state: "done",
      output: { urls },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 3: composite (P2)

/**
 * Draws each designed character as a reference image, exactly the way Video
 * Animation's designCharacters does: nano-banana-2 at 1:1 whatever the deck's
 * own ratio (a reference is a portrait of one subject, and every slide is
 * edited from it, so it should not be cropped to the frame), in parallel
 * since the images are independent, with the three-rung content-policy
 * fallback -- original prompt, reworded, then a bare reference pose.
 *
 * The bare rung names the deck's own style rather than the "Pixar-style" the
 * story-to-animation app hardcodes, because this format has a style picker
 * and a hardcoded style would silently override every other choice on it.
 */
async function drawCast(
  characters: CastMember[],
  config: SlideshowConfig,
): Promise<DrawnCastMember[]> {
  const style = config.style ?? DEFAULT_STYLE;
  return Promise.all(
    characters.map(async (c) => {
      const buildInput = (prompt: string) => ({
        prompt,
        aspect_ratio: "1:1",
        output_format: config.imageOutputFormat ?? "png",
        safety_tolerance: config.imageSafetyTolerance ?? "4",
        num_images: 1,
      });
      const result = (await submitWithContentPolicyFallback(
        IMAGE_MODEL,
        buildInput,
        c.prompt,
        () =>
          `${style} reference image of ${c.name}, neutral pose, plain white background, ` +
          "soft even lighting, no text, no watermark.",
      )) as { images?: { url?: string }[] };
      const url = result.images?.[0]?.url;
      if (!url) throw new Error(`no image returned for character ${c.name}`);
      return { ...c, url };
    }),
  );
}

/**
 * The old settings page's Composite Scenes card, doing the equivalent job for
 * a format with no characters and no background plates: a cast -- a product,
 * a mascot, a face -- edited into every generated slide, so slide 1 and
 * slide 10 show recognisably the same thing. The cast is the client's own
 * uploads, or, when there are none, characters the plan step designed and
 * `drawCast` draws.
 *
 * Runs in parallel across slides for the same reason `generateImages` does,
 * and rewrites the images step's `urls` in place so `render` below needs to
 * know nothing about whether this ran.
 */
export const compositeSubject = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SlideshowConfig;

    const plan = (job.steps.find((s) => s.id === "copy")?.output as
      | { slides?: SlidePlan[]; characters?: CastMember[] }
      | undefined);
    const slides = plan?.slides;
    const urls = (job.steps.find((s) => s.id === "images")?.output as
      | { urls?: string[] }
      | undefined)?.urls;
    if (!slides?.length || !urls?.length) throw new Error("missing plan or generated images");

    const refIds = config.compositeReferenceAssetIds ?? [];

    /**
     * No upload means the cast is drawn here, from the prompts the plan
     * step wrote -- the story-to-animation app's character images, made when
     * the user has none of their own. A retry of this step finds them
     * already saved on its own output and reuses them rather than paying to
     * draw the same faces again.
     */
    const savedCast = (job.steps.find((s) => s.id === "composite")?.output as
      | { cast?: DrawnCastMember[] }
      | undefined)?.cast;
    const toDraw = refIds.length || savedCast?.length ? [] : (plan?.characters ?? []);
    if (!refIds.length && !savedCast?.length && !toDraw.length) {
      throw new Error(
        "Composite scenes is on, but no character or subject images were uploaded " +
          "and the slide plan did not design any. Upload at least one, or re-run " +
          "the slideshow so the cast is designed.",
      );
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd:
        toDraw.length * IMAGE_PRICE_PER_UNIT + urls.length * COMPOSITE_PRICE_PER_UNIT,
    });

    let cast = savedCast;
    if (toDraw.length) {
      cast = await drawCast(toDraw, config);
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "composite",
        primitive: "P2",
        model: IMAGE_MODEL,
        units: cast.length,
        unitLabel: "images",
        costUsd: cast.length * IMAGE_PRICE_PER_UNIT,
      });
      await ctx.runMutation(internal.jobs.patchStep, {
        jobId,
        stepId: "composite",
        output: { cast },
      });
    }

    // Order is the cast list: reference i is "Character i + 1" in both the
    // planning prompt and the edit prompt below -- uploaded or drawn.
    let refUrls: string[];
    if (cast?.length) {
      refUrls = cast.map((c) => c.url);
    } else {
      refUrls = (
        await Promise.all(refIds.map((assetId) => assetUrlOf(ctx, assetId)))
      ).filter((u): u is string => Boolean(u));
      if (refUrls.length !== refIds.length) {
        throw new Error("one of the character images could not be read");
      }
    }

    /**
     * Each reference is named by its index, the way drama.ts names a
     * storyboard's cast sheets. Naming them is what lets a slide's own
     * imagePrompt say "Character 2 turns away" and have that resolve to a
     * specific face rather than to whatever the model invents.
     */
    const castNames = refUrls
      .map((_, i) => `Image ${i + 2} is Character ${i + 1}.`)
      .join(" ");

    const composited = await Promise.all(
      urls.map(async (slideUrl, i) => {
        const result = (await submitAndPoll(COMPOSITE_MODEL, {
          prompt:
            `Image 1 is the scene. ${castNames} ` +
            `Redraw the scene with whichever characters it calls for present in it. ` +
            `Scene: ${slides[i]?.imagePrompt ?? ""}. ` +
            "Keep each character's face, hair, build, colors, markings and costume exactly as in " +
            "their reference image -- do not redraw or restyle them. Match the scene's lighting " +
            "direction, color temperature, perspective and shadows so they belong in it. " +
            "Keep Image 1's framing and background. No text, no watermark, no UI elements.",
          image_urls: [slideUrl, ...refUrls],
          aspect_ratio: imageAspectRatio(config),
          output_format: config.compositeOutputFormat ?? "jpeg",
          safety_tolerance: config.imageSafetyTolerance ?? "4",
          num_images: 1,
        })) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no composite returned for slide ${i + 1}`);
        return url;
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "composite",
      primitive: "P2",
      model: COMPOSITE_MODEL,
      units: composited.length,
      unitLabel: "images",
      costUsd: composited.length * COMPOSITE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "done",
      output: cast?.length ? { cast, urls: composited } : { urls: composited },
    });
    // The render step reads whichever of these two ran last.
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "images",
      output: { urls: composited },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 5: music (P4)

/**
 * The score is as long as the voiceover -- X seconds, known by now because the
 * voice was recorded first. The shared step clamps it to what CassetteAI
 * accepts (10-180 seconds), and the renderer loops or trims it to fit.
 */
export const scoreMusic = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SlideshowConfig;
    const voice = voiceOf(job);
    if (!voice) throw new Error("nothing to score");

    await scoreMusicStep(ctx, {
      jobId,
      clientId,
      wantedSeconds: voice.seconds,
      subject: config.prompt?.trim() || voice.script.slice(0, 300),
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 6: the cut (P8)

export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SlideshowConfig;

    const plan = (job.steps.find((s) => s.id === "copy")?.output as
      | { slides?: SlidePlan[] }
      | undefined)?.slides;
    const urls = (job.steps.find((s) => s.id === "images")?.output as
      | { urls?: string[] }
      | undefined)?.urls;
    if (!plan?.length || !urls?.length) throw new Error("missing plan or generated images");

    // The one continuous voiceover the whole cut was built around.
    const voiceoverUrl = voiceOf(job)?.audioUrl;
    if (!voiceoverUrl) throw new Error("missing voiceover");
    const musicUrl =
      (job.steps.find((s) => s.id === "music")?.output as { url?: string } | undefined)?.url ??
      null;

    // Bookend frames and brand cards are folded into this one call rather
    // than run as their own steps -- see bookendsAndBranding.
    const { startVideoUrl, endVideoUrl, branding } = await bookendsAndBranding(ctx, config);

    // A finished cut with bookends and a score clears Convex's function-
    // argument ceiling as base64, so the render service uploads the bytes
    // straight to a signed URL -- the same path the browser's own
    // UploadField takes, with the service standing in for a person.
    const uploadUrl = await ctx.storage.generateUploadUrl();

    // fal already hosts the slide images at public URLs, so the render
    // service fetches them directly rather than Convex downloading and
    // re-uploading as base64 first -- one fewer round trip for exactly the
    // case that would hurt most (N images, not one).
    const res = await fetch(`${renderServiceBase()}/render/slideshow`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        images: urls.map((url) => ({ url })),
        dimensions: aspectRatio(config),
        // Every slide holds for exactly this long, whatever is said over it --
        // the count of slides is what was fitted to the voice, not the other
        // way round.
        secondsPerImage: SCENE_SECONDS,
        voiceoverUrl,
        musicUrl,
        musicVolume: musicVolumeOf(config),
        startVideoUrl,
        endVideoUrl,
        branding,
        uploadUrl,
      }),
    });
    if (!res.ok) {
      throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    }

    const out = (await res.json()) as {
      width: number;
      height: number;
      storageId: Id<"_storage">;
      bytes: number;
      contentType: string;
    };

    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      producedByJobId: jobId,
      storageId: out.storageId,
      mimeType: out.contentType,
      bytes: out.bytes,
      width: out.width,
      height: out.height,
    });

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "render",
      primitive: "P8",
      model: "chrome+ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      output: { files: [{ name: "slideshow.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

// ---------------------------------------------------------------- stage 7: upscale (P3)

export const upscale = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    const scenes = (job ? voiceOf(job)?.sceneCount : undefined) ?? 10;
    await upscaleStep(ctx, { jobId, clientId, fallbackSeconds: scenes * SCENE_SECONDS });
    return null;
  },
});

// ---------------------------------------------------------------- stage 8: subtitles (P8)

export const burnSubtitles = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    const scenes = (job ? voiceOf(job)?.sceneCount : undefined) ?? 10;
    await subtitlesStep(ctx, {
      jobId,
      clientId,
      fallbackSeconds: scenes * SCENE_SECONDS,
      defaultAspect: DEFAULT_ASPECT_RATIO,
    });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.slideshow.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
