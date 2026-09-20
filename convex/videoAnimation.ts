import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import {
  callSync,
  callTool,
  LLM_MODEL,
  submitWithContentPolicyFallback,
} from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { GROUNDING_RULES } from "./lib/grounding";
import {
  animateClip,
  characterElement,
  clipModelFor,
  clipRate,
  MAX_CLIP_SECONDS,
} from "./lib/klingClip";

/**
 * Video Animation: story -> characters -> shots -> composites -> clips ->
 * voice -> stitch. The old app's flagship, and the reason porting it early
 * pays for the whole rewrite -- it lands P2, P3 and P4 in one phase and forces
 * the approval-gate mechanism Product Spokesperson needs later.
 *
 * Three gates use `step.awaitEvent`, which suspends the workflow completely
 * (no resources consumed) until `jobs.approveStep` sends the matching event.
 * This is the first format where Convex's 10-minute action ceiling is a real
 * constraint rather than a theoretical one -- vidu clips can take minutes
 * each, which is why they run through `submitAndPoll` with its own timeout
 * budget rather than being awaited inline for longer than that.
 *
 * Prompts and request shapes below are ported from the old app's
 * lib/claude.js and worker/pipeline.py. Two deliberate departures, both
 * documented at the point they happen: the composite prompt uses the
 * project's own chosen style instead of a hardcoded "Pixar-style", and the
 * aspect-ratio table has a 4:5 entry the old app was silently missing.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const { jobId, clientId } = args;
    try {
      await step.runAction(internal.videoAnimation.writeStory, args, { retry: true });
      await step.awaitEvent({ name: `approve:${jobId}:story` });
      await step.runMutation(internal.jobs.patchStep, { jobId, stepId: "story", state: "done" });
      await step.runMutation(internal.jobs.setRunning, { jobId });

      await step.runAction(internal.videoAnimation.designCharacters, args, { retry: true });
      await step.awaitEvent({ name: `approve:${jobId}:characters` });
      await step.runMutation(internal.jobs.patchStep, { jobId, stepId: "characters", state: "done" });
      await step.runMutation(internal.jobs.setRunning, { jobId });

      await step.runAction(internal.videoAnimation.writeShotList, args, { retry: true });
      await step.awaitEvent({ name: `approve:${jobId}:shots` });
      await step.runMutation(internal.jobs.patchStep, { jobId, stepId: "shots", state: "done" });
      await step.runMutation(internal.jobs.setRunning, { jobId });

      await step.runAction(internal.videoAnimation.compositeScenes, args, { retry: true });
      await step.runAction(internal.videoAnimation.generateClips, args, { retry: true });
      await step.runAction(internal.videoAnimation.generateVoiceover, args, { retry: true });
      await step.runAction(internal.videoAnimation.stitch, args, { retry: true });

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

// ---------------------------------------------------------------- pricing
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
const IMAGE_PRICE_PER_UNIT = 0.08; // fal-ai/nano-banana-2 at 1K
const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K
const TTS_PRICE_PER_1000_CHARS = 0.1; // fal-ai/elevenlabs/tts/eleven-v3

function llmCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * LLM_INPUT_PER_1M + (outputTokens / 1e6) * LLM_OUTPUT_PER_1M;
}

// ---------------------------------------------------------------- types
interface Character {
  character_id: string;
  name: string;
  description: string;
  prompt: string;
  scenes_appearing: number[];
  image_url?: string;
}
interface Background {
  bg_id: string;
  name: string;
  description: string;
  prompt: string;
  scenes_used_in: number[];
  image_url?: string;
}
interface Shot {
  shot_id: string;
  scene_number: number;
  scene_title: string;
  shot_number_in_scene: number;
  duration_seconds: number;
  characters: string[];
  background: string;
  action: string;
  camera_movement: string;
  dialogue: string;
  mood: string;
  veo_prompt: string;
  composite_url?: string;
  clip_url?: string;
  audio_url?: string;
}

function config(job: { config: unknown }) {
  return job.config as {
    logline?: string;
    durationSec?: number;
    style?: string;
    aspectRatio?: string;
    language?: string;
    videoModel?: string;
  };
}

const PER_SHOT_SECONDS = 5;

// ---------------------------------------------------------------- stage 1: story
const STORY_SYSTEM = `You expand a short story logline into a structured animation screenplay.

Instructions:
1. Analyze the logline: identify genre, tone, conflict arc, and resolution.
2. Expand into 8-15 scenes (targets ~3-5 minutes at ~8 sec/shot, but the
   project's target duration below takes priority if it implies fewer scenes).
3. Each scene must include:
   - Scene number and title
   - Location: detailed visual description (used for background image generation)
   - Characters present: with brief visual descriptions on first appearance
   - Action and dialogue: visual storytelling focus (show, don't tell)
   - Shot Notes: suggested camera angles/movements (wide, close-up, tracking, etc.)
   - Tone/Pacing: emotional beat
4. Write for 3D animation: visually descriptive and action-oriented.
5. Keep character count manageable (3-6 main characters).
6. Dialogue should sound like something a specific person would actually say
   in this specific moment -- avoid generic movie-trailer lines ("This changes
   everything", "We have to go, now!") that could drop into any story
   unchanged.

${GROUNDING_RULES}

Output as markdown with this structure:

# [Story Title]

## Logline
[Original logline]

## Characters
- **Name**: Brief description (age, appearance, personality)

## Scene 1: [Scene Title]
**Location**: [Detailed visual setting description]
**Characters**: [Characters present]
**Time of Day**: [Morning/Afternoon/Night]

[Narrative action and dialogue]

**Shot Notes**: [Camera angles and movements]
**Tone**: [Emotional beat]

---

## Scene 2: ...`;

const STORY_TOOL = {
  name: "save_story",
  description: "Save the generated story screenplay as markdown.",
  input_schema: {
    type: "object",
    properties: {
      markdown: {
        type: "string",
        description: "The full story, formatted exactly per the system instructions.",
      },
    },
    required: ["markdown"],
  },
};

export const writeStory = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "story", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const logline = (cfg.logline ?? "").trim();
    if (!logline) throw new Error("A logline or script is required.");
    const targetDurationSeconds = cfg.durationSec ?? 30;
    const imageStyle = cfg.style ?? "Pixar-style 3D animation, cinematic lighting";

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.05 });

    const prompt =
      `Logline: ${logline}\n` +
      `Target final video length: ${targetDurationSeconds} seconds ` +
      `(~${Math.max(1, Math.round(targetDurationSeconds / PER_SHOT_SECONDS))} five-second shots downstream -- ` +
      `pace scene count accordingly, fewer scenes for shorter videos).\n` +
      `Art direction for visual descriptions: ${imageStyle}.`;

    const call = await callTool(STORY_SYSTEM, prompt, STORY_TOOL as never);
    const markdown = String((call.value as { markdown?: string })?.markdown ?? "").trim();
    if (!markdown) throw new Error("model returned an empty story");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "story",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call.inputTokens, call.outputTokens),
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "story",
      output: { markdown },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 2: characters + backgrounds
const CHARACTERS_SYSTEM = `Parse a story screenplay to extract unique characters and locations, then write
detailed image-generation prompts for each.

Characters:
1. Identify every unique character mentioned across all scenes.
2. For each, generate a detailed image prompt covering physical appearance
   (age, build, skin tone, hair, eyes), clothing/accessories, expression and
   pose (neutral, full body, for reference sheet), and an art style suffix
   consistent with the requested style, ending in something like:
   "full body, character reference sheet, symmetrical standing pose, anatomically
   correct proportions and hands, plain white background, high detail, soft
   even lighting, no text, no watermark". Be specific and consistent about
   distinguishing features (exact hair color/style, exact clothing colors) --
   every later shot that includes this character reuses this same image
   as its reference, so vague description here becomes visible drift later.
3. Assign IDs sequentially: char_001, char_002, ...
4. Record which scene numbers each character appears in.

Backgrounds:
1. Identify every unique location across all scenes.
2. Deduplicate: same location across multiple scenes = same bg_id.
3. For each, generate a detailed image prompt covering environment type
   (interior/exterior), architectural or natural details, lighting and time
   of day, mood/atmosphere, and an art style suffix ending in something like:
   "cinematic wide shot, no characters, high detail, no text, no watermark".
4. Assign IDs sequentially: bg_001, bg_002, ...
5. Record which scene numbers each background is used in.`;

const CHARACTERS_TOOL = {
  name: "save_characters_and_backgrounds",
  description: "Save the extracted characters and backgrounds.",
  input_schema: {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            character_id: { type: "string", pattern: "^char_\\d{3}$" },
            name: { type: "string" },
            description: { type: "string" },
            prompt: { type: "string" },
            scenes_appearing: { type: "array", items: { type: "integer" } },
          },
          required: ["character_id", "name", "description", "prompt", "scenes_appearing"],
        },
      },
      backgrounds: {
        type: "array",
        items: {
          type: "object",
          properties: {
            bg_id: { type: "string", pattern: "^bg_\\d{3}$" },
            name: { type: "string" },
            description: { type: "string" },
            prompt: { type: "string" },
            scenes_used_in: { type: "array", items: { type: "integer" } },
          },
          required: ["bg_id", "name", "description", "prompt", "scenes_used_in"],
        },
      },
    },
    required: ["characters", "backgrounds"],
  },
};

/**
 * Combines the old app's two separate concerns -- extracting character and
 * background PROMPTS (text), then generating their IMAGES much later in a
 * non-interactive render job -- into one gated step. Reviewing the actual
 * pictures before committing to a shot list is a better place to catch a
 * wrong-looking character than reviewing prose about them, which is why this
 * step is declared as P2 in the registry rather than P1.
 */
export const designCharacters = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "characters", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const imageStyle = cfg.style ?? "Pixar-style 3D animation, cinematic lighting";
    const storyMarkdown = String(
      (job.steps.find((s) => s.id === "story")?.output as { markdown?: string } | undefined)
        ?.markdown ?? "",
    );
    if (!storyMarkdown) throw new Error("no approved story to extract characters from");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.3 });

    const call = await callTool(
      CHARACTERS_SYSTEM,
      `Art direction: ${imageStyle}.\n\nStory:\n\n${storyMarkdown}`,
      CHARACTERS_TOOL as never,
    );
    const extracted = call.value as { characters?: Character[]; backgrounds?: Background[] };
    const characters = extracted.characters ?? [];
    const backgrounds = extracted.backgrounds ?? [];
    if (!characters.length || !backgrounds.length) {
      throw new Error("model returned no characters or no backgrounds");
    }

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "characters",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call.inputTokens, call.outputTokens),
    });

    // Characters are always a 1:1 reference sheet regardless of the project's
    // aspect ratio; backgrounds match the project so composites don't have to
    // crop them later. Both run in parallel -- independent images, nothing to
    // serialise.
    const backgroundAspect = cfg.aspectRatio ?? "16:9";
    const [charImages, bgImages] = await Promise.all([
      Promise.all(
        characters.map(async (c) => {
          const buildInput = (prompt: string) => ({
            prompt,
            aspect_ratio: "1:1",
            output_format: "png",
            safety_tolerance: "4",
            num_images: 1,
          });
          // Ported minimal fallback: drop straight to a bare reference-sheet
          // pose. This is what actually cleared the checker in the old app's
          // own recorded case where reasonable prose was rejected twice.
          const result = (await submitWithContentPolicyFallback(
            "fal-ai/nano-banana-2",
            buildInput,
            c.prompt,
            () =>
              "Pixar-style 3D animation character reference sheet, neutral pose, " +
              "plain background, soft even lighting, no text, no watermark.",
          )) as { images?: { url?: string }[] };
          const url = result.images?.[0]?.url;
          if (!url) throw new Error(`no image returned for character ${c.character_id}`);
          return { ...c, image_url: url };
        }),
      ),
      Promise.all(
        backgrounds.map(async (b) => {
          const buildInput = (prompt: string) => ({
            prompt,
            aspect_ratio: backgroundAspect,
            output_format: "png",
            safety_tolerance: "4",
            num_images: 1,
          });
          const result = (await submitWithContentPolicyFallback(
            "fal-ai/nano-banana-2",
            buildInput,
            b.prompt,
            () =>
              "Pixar-style 3D animation background plate, empty establishing shot, " +
              "no characters, soft natural lighting, no text, no watermark.",
          )) as { images?: { url?: string }[] };
          const url = result.images?.[0]?.url;
          if (!url) throw new Error(`no image returned for background ${b.bg_id}`);
          return { ...b, image_url: url };
        }),
      ),
    ]);

    const imageCount = charImages.length + bgImages.length;
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "characters",
      primitive: "P2",
      model: "fal-ai/nano-banana-2",
      units: imageCount,
      unitLabel: "images",
      costUsd: imageCount * IMAGE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "characters",
      output: { characters: charImages, backgrounds: bgImages },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 3: shot list
const SHOTS_SYSTEM = `Decompose a story into discrete shots of a FIXED duration (given in the
prompt as "shots of Ns each") mapped to character/background IDs and
self-contained video generation prompts.

Shot count and per-shot duration are both given exactly in the prompt as
"Target: exactly N shots of Ds seconds each" -- use those numbers precisely,
do not recompute them. Distribute shots across scenes proportionally to
their importance/length; break each scene into 1-3 shots.

Assign sequential IDs: shot_001, shot_002, ...

For each shot:
- duration_seconds: exactly the per-shot duration given in the prompt, for every shot
- characters: list of character_id's present (must match the given characters)
- background: the bg_id for this location (must match the given backgrounds)
- action: clear visual description of what happens in this shot
- camera_movement: e.g. "static wide shot", "slow dolly-in", "pan left",
  "close-up on face", "tracking shot"
- dialogue: spoken line if any, or "" if none.
- mood: emotional tone
- veo_prompt: a self-contained video generation prompt for an image-to-video
  model that receives this shot's already-composited image alongside it --
  its job is to describe MOTION within that fixed image, not to re-describe
  what the image already shows. Do NOT use asset IDs in it. Pattern:
  "[shot type + camera movement], [what moves and how -- gesture, expression
  change, camera drift], keep composition, characters and setting exactly as
  in the source image, [duration hint]". Naming the art style or re-describing
  a character's appearance here risks the model redrawing the frame instead
  of animating it, which is what causes warping between frames.`;

const SHOTS_TOOL = {
  name: "save_shot_list",
  description: "Save the shot-by-shot breakdown.",
  input_schema: {
    type: "object",
    properties: {
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            shot_id: { type: "string", pattern: "^shot_\\d{3}$" },
            scene_number: { type: "integer" },
            scene_title: { type: "string" },
            shot_number_in_scene: { type: "integer" },
            duration_seconds: { type: "integer" },
            characters: { type: "array", items: { type: "string" } },
            background: { type: "string" },
            action: { type: "string" },
            camera_movement: { type: "string" },
            dialogue: { type: "string" },
            mood: { type: "string" },
            veo_prompt: { type: "string" },
          },
          required: [
            "shot_id", "scene_number", "scene_title", "shot_number_in_scene",
            "duration_seconds", "characters", "background", "action",
            "camera_movement", "dialogue", "mood", "veo_prompt",
          ],
        },
      },
    },
    required: ["shots"],
  },
};

export const writeShotList = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "shots", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const imageStyle = cfg.style ?? "Pixar-style 3D animation, cinematic lighting";
    const targetDurationSeconds = cfg.durationSec ?? 30;

    const storyMarkdown = String(
      (job.steps.find((s) => s.id === "story")?.output as { markdown?: string } | undefined)
        ?.markdown ?? "",
    );
    const cast = job.steps.find((s) => s.id === "characters")?.output as
      | { characters?: Character[]; backgrounds?: Background[] }
      | undefined;
    const characters = cast?.characters ?? [];
    const backgrounds = cast?.backgrounds ?? [];
    if (!storyMarkdown || !characters.length || !backgrounds.length) {
      throw new Error("story and characters must be approved before writing shots");
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.1 });

    const shotCount = Math.max(1, Math.round(targetDurationSeconds / PER_SHOT_SECONDS));
    const prompt =
      `Target: exactly ${shotCount} shots of ${PER_SHOT_SECONDS} seconds each ` +
      `(${shotCount * PER_SHOT_SECONDS}s total).\n` +
      `Art direction: ${imageStyle}.\n\n` +
      `Available characters:\n${JSON.stringify(
        characters.map((c) => ({ character_id: c.character_id, name: c.name, description: c.description })),
        null, 2,
      )}\n\n` +
      `Available backgrounds:\n${JSON.stringify(
        backgrounds.map((b) => ({ bg_id: b.bg_id, name: b.name, description: b.description })),
        null, 2,
      )}\n\n` +
      `Story:\n\n${storyMarkdown}`;

    const call = await callTool(SHOTS_SYSTEM, prompt, SHOTS_TOOL as never);
    const shots = ((call.value as { shots?: Shot[] })?.shots ?? []).filter(
      (s) => backgrounds.some((b) => b.bg_id === s.background),
    );
    if (shots.length < 1) throw new Error("model returned no valid shots");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "shots",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call.inputTokens, call.outputTokens),
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "shots",
      output: { shots },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 4: composites (P2)

/**
 * Fixes a real gap in the old app rather than porting it: `4:5` was a valid
 * project aspect ratio with no entry here, so it silently fell back to
 * 16:9 -- wrong for a format whose own aspect-ratio picker offers 4:5.
 */
const ASPECT_TO_COMPOSITE_IMAGE_SIZE: Record<string, string> = {
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "4:5": "portrait_4_3",
};
const COMPOSITE_FRAMING_DESCRIPTION: Record<string, string> = {
  landscape_16_9: "Cinematic 16:9 landscape composition",
  portrait_16_9: "Cinematic 9:16 portrait composition",
  square_hd: "Cinematic 1:1 square composition",
  landscape_4_3: "Cinematic 4:3 landscape composition",
  portrait_4_3: "Cinematic portrait composition",
};

export const compositeScenes = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scenes", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const imageStyle = cfg.style ?? "Pixar-style 3D animation, cinematic lighting";
    const imageSize = ASPECT_TO_COMPOSITE_IMAGE_SIZE[cfg.aspectRatio ?? "16:9"] ?? "landscape_16_9";
    const framing = COMPOSITE_FRAMING_DESCRIPTION[imageSize] ?? "Cinematic composition";

    const cast = job.steps.find((s) => s.id === "characters")?.output as
      | { characters?: Character[]; backgrounds?: Background[] }
      | undefined;
    const shotsOut = job.steps.find((s) => s.id === "shots")?.output as { shots?: Shot[] } | undefined;
    const characters = cast?.characters ?? [];
    const backgrounds = cast?.backgrounds ?? [];
    const shots = shotsOut?.shots ?? [];
    if (!shots.length) throw new Error("no shots to composite");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: shots.length * COMPOSITE_PRICE_PER_UNIT,
    });

    const charById = new Map(characters.map((c) => [c.character_id, c]));
    const bgById = new Map(backgrounds.map((b) => [b.bg_id, b]));

    const composited = await Promise.all(
      shots.map(async (shot) => {
        const bg = bgById.get(shot.background);
        if (!bg?.image_url) throw new Error(`no background image for shot ${shot.shot_id}`);
        const shotChars = shot.characters
          .map((id) => charById.get(id))
          .filter((c): c is Character => Boolean(c?.image_url));

        // Background first, then each character in shot order -- @image1,
        // @image2... refer to this exact sequence, and the old app never
        // caps how many characters can be in one shot.
        const imageUrls = [bg.image_url, ...shotChars.map((c) => c.image_url!)];
        const refTags = imageUrls.map((_, i) => `@image${i + 1}`).join(" ");
        const charNames = shotChars.map((c) => c.name).join(", ");

        // Deliberately NOT hardcoded to "Pixar-style" the way the old app's
        // wrapper was -- this format has its own style picker, and ignoring
        // it would silently break every non-Pixar selection.
        const wrap = (body: string) =>
          `${imageStyle} composite scene using ${refTags}. ` +
          `Place ${charNames ? charNames + " " : ""}in the background setting. ` +
          `${body} ` +
          `${framing}, high quality render, no text, no watermark, no UI elements, ` +
          `warm natural lighting consistent with the scene. Keep each character's appearance ` +
          "consistent with their own reference image, even with several characters in frame.";

        // Content-checker rejections are real and not rare -- the first
        // draft of this pipeline hit one on its very first real run, on
        // prose that reads as entirely benign ("a robot lifts debris to
        // reveal a glowing seed"). fal's checker is documented as sometimes
        // sensitive to phrasing rather than content, which is exactly why a
        // reworded retry is rung 2 rather than giving up after rung 1.
        // `safety_tolerance` was flux-2-pro/edit's own knob and has no
        // equivalent on qwen-image-3/edit; `enable_safety_checker` is the
        // one both accept. The image_size enum is identical between them,
        // so the aspect-ratio table above carries over untouched.
        const buildInput = (prompt: string) => ({
          prompt,
          image_urls: imageUrls,
          image_size: imageSize,
          output_format: "jpeg",
          enable_safety_checker: true,
        });
        // Rung 3: the full wrapper survives, only the scene prose is dropped
        // down to the bare scene title and mood -- ported from the old app's
        // exact minimal-composite fallback.
        const minimalPrompt = () =>
          wrap(
            `Scene: ${shot.scene_title || "story moment"}.` +
              (shot.mood ? ` Mood: ${shot.mood}.` : ""),
          );

        const result = (await submitWithContentPolicyFallback(
          "alibaba/qwen-image-3/edit",
          buildInput,
          wrap(shot.action),
          minimalPrompt,
        )) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no composite returned for shot ${shot.shot_id}`);
        return { ...shot, composite_url: url };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scenes",
      primitive: "P2",
      model: "alibaba/qwen-image-3/edit",
      units: composited.length,
      unitLabel: "composites",
      costUsd: composited.length * COMPOSITE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scenes",
      state: "done",
      output: { shots: composited },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 5: clips (P3)
export const generateClips = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clips", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const shots = ((job.steps.find((s) => s.id === "scenes")?.output as { shots?: Shot[] } | undefined)
      ?.shots ?? []) as Shot[];
    if (!shots.length) throw new Error("no composited shots to animate");

    const secondsOf = (s: Shot) =>
      Math.min(MAX_CLIP_SECONDS, s.duration_seconds || PER_SHOT_SECONDS);
    const totalSeconds = shots.reduce((sum, s) => sum + secondsOf(s), 0);
    const model = clipModelFor(config(job).videoModel);
    const rate = clipRate(model);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: totalSeconds * rate,
    });

    // The cast sheets drawn back in stage 2, so each shot can be held to the
    // same faces rather than only to whatever its own composite happened to
    // show. Kling takes at most a handful, and a shot rarely has more.
    const cast = job.steps.find((s) => s.id === "characters")?.output as
      | { characters?: Character[] }
      | undefined;
    const charById = new Map((cast?.characters ?? []).map((c) => [c.character_id, c]));

    const animated = await Promise.all(
      shots.map(async (shot, i) => {
        if (!shot.composite_url) throw new Error(`shot ${shot.shot_id} has no composite to animate`);
        // Within one scene the shots are consecutive moments, so each clip is
        // made to land on the next one's opening frame and the cut joins.
        // Across a scene change it should NOT: that cut is meant to be felt.
        const next = shots[i + 1];
        const endImageUrl =
          next?.composite_url && next.scene_number === shot.scene_number
            ? next.composite_url
            : undefined;

        const onScreen = shot.characters
          .map((id) => charById.get(id))
          .filter((c): c is Character => Boolean(c?.image_url))
          .slice(0, 4);
        const named = onScreen
          .map((c, n) => `${c.name} is @Element${n + 1} and keeps that exact design.`)
          .join(" ");

        const url = await animateClip({
          model,
          startImageUrl: shot.composite_url,
          endImageUrl,
          elements: onScreen.map((c) => characterElement(c.image_url!, shot.composite_url)),
          seconds: secondsOf(shot),
          prompt:
            `${named} ${shot.veo_prompt || shot.action} ` +
            (endImageUrl ? "The shot settles into its final framing at the end. " : "") +
            "Faces and hands stay whole and correctly formed throughout, and the set and " +
            "lighting stay exactly as they start.",
          minimalPrompt: () =>
            "Subtle cinematic camera movement and gentle ambient motion. " +
            "Keep the composition and characters exactly as in the source image, " +
            "with no warping or distortion of faces or hands.",
        });
        return { ...shot, clip_url: url };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clips",
      primitive: "P3",
      model,
      units: totalSeconds,
      unitLabel: "seconds",
      costUsd: totalSeconds * rate,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clips",
      state: "done",
      output: { shots: animated },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 6: voiceover (P4)
export const generateVoiceover = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "voice", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const languageCode = cfg.language ?? "en";
    const shots = ((job.steps.find((s) => s.id === "clips")?.output as { shots?: Shot[] } | undefined)
      ?.shots ?? []) as Shot[];
    if (!shots.length) throw new Error("no animated shots to voice");

    const speaking = shots.filter((s) => (s.dialogue ?? "").trim());
    const totalChars = speaking.reduce((sum, s) => sum + s.dialogue.length, 0);

    if (speaking.length) {
      await ctx.runMutation(internal.ledger.assertUnderCap, {
        clientId,
        aboutToSpendUsd: (totalChars / 1000) * TTS_PRICE_PER_1000_CHARS,
      });
    }

    // One call per shot that actually speaks -- the old app's own approach
    // (no cross-shot narration track). Simpler and, since each shot becomes
    // its own audio segment muxed onto its own clip in the stitch step,
    // avoids the cumulative-offset drift a single continuous track risks.
    const voiced = await Promise.all(
      shots.map(async (shot) => {
        const text = (shot.dialogue ?? "").trim();
        if (!text) return shot;
        // eleven-v3: `similarity_boost`, `style` and `speed` are not in its
        // schema (see speechPrimitive.ts for the full note).
        const result = (await callSync("fal-ai/elevenlabs/tts/eleven-v3", {
          text,
          voice: "Sarah",
          stability: 0.5,
          language_code: languageCode,
          apply_text_normalization: "auto",
        })) as { audio?: { url?: string } };
        const url = result.audio?.url;
        if (!url) throw new Error(`no audio returned for shot ${shot.shot_id}`);
        return { ...shot, audio_url: url };
      }),
    );

    if (speaking.length) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "voice",
        primitive: "P4",
        model: "fal-ai/elevenlabs/tts/eleven-v3",
        units: totalChars,
        unitLabel: "chars",
        costUsd: (totalChars / 1000) * TTS_PRICE_PER_1000_CHARS,
      });
    }
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "voice",
      state: "done",
      output: { shots: voiced },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 7: stitch (P7)
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const shots = ((job.steps.find((s) => s.id === "voice")?.output as { shots?: Shot[] } | undefined)
      ?.shots ?? []) as Shot[];
    if (!shots.length) throw new Error("no voiced shots to stitch");

    const base = renderServiceBase();

    // A stitched video routinely lands well past Convex's 16MB
    // function-argument ceiling -- the first real run here hit 17.5MB as
    // base64 alone, after already fixing a *separate* 64MB heap limit on
    // decoding it (see nodeStorage.ts's own comment for that one). Both
    // limits are dodged the same way the browser's own uploads are:
    // generate a signed URL and have the writer -- here, the render
    // service, not a person -- PUT bytes directly into storage, never
    // through a function argument at all.
    const uploadUrl = await ctx.storage.generateUploadUrl();

    const res = await fetch(`${base}/render/video-animation`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        shots: shots.map((s) => ({
          videoUrl: s.clip_url,
          audioUrl: s.audio_url ?? null,
          durationSec: s.duration_seconds || PER_SHOT_SECONDS,
          caption: (s.dialogue ?? "").trim() || null,
        })),
        dimensions: cfg.aspectRatio ?? "16:9",
        captionStyle: "Classic",
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

    const assetIds = [
      await ctx.runMutation(internal.assets.record, {
        clientId,
        producedByJobId: jobId,
        storageId: out.storageId,
        mimeType: out.contentType,
        bytes: out.bytes,
        width: out.width,
        height: out.height,
      }),
    ];

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "stitch",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "stitch",
      state: "done",
      output: { files: [{ name: "output.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.videoAnimation.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
