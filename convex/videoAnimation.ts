import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import { assertVoiceoverSupport, renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import {
  animateClip,
  characterElement,
  clipModelFor,
  clipRate,
  MAX_CLIP_SECONDS,
} from "./lib/klingClip";
import {
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
 * Video Animation: script -> voiceover -> characters -> shots -> composites ->
 * clips -> stitch. The old app's flagship, and the reason porting it early
 * pays for the whole rewrite -- it lands P2, P3 and P4 in one phase and forces
 * the approval-gate mechanism Product Spokesperson needs later.
 *
 * The video is cut to its voiceover. The script is recorded first; however
 * long that takes (X seconds) becomes X / 3 shots of three seconds each, and
 * each shot is planned around the words spoken while it is on screen. So
 * nobody is asked how long the video should be -- the script already says.
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
      // Which optional steps exist is decided once, at submit, by the
      // pipeline's `when` conditions -- so this is the authority, never a
      // second reading of the config.
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId });

      // The voiceover comes first and everything else is cut to it. Nothing
      // before the cast is gated: the script is the person's own, and the first
      // thing worth reviewing is what the characters look like.
      await step.runAction(internal.videoAnimation.recordVoiceover, args, { retry: true });

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

      if (planned.includes("music")) {
        await step.runAction(internal.videoAnimation.scoreMusic, args, { retry: true });
      }

      await step.runAction(internal.videoAnimation.stitch, args, { retry: true });

      // Both replace the job's output asset with a new one, in this order:
      // burning subtitles in first would send the text through Topaz too,
      // softening the one element that was already pixel-sharp.
      if (planned.includes("upscale")) {
        await step.runAction(internal.videoAnimation.upscale, args, { retry: true });
      }
      if (planned.includes("subtitles")) {
        await step.runAction(internal.videoAnimation.burnSubtitles, args, { retry: true });
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

// ---------------------------------------------------------------- pricing
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
const IMAGE_PRICE_PER_UNIT = 0.08; // fal-ai/nano-banana-2 at 1K
const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K

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

/**
 * The job's frozen config. Every field is optional because a job created
 * before a field existed still has to run -- and each default below is what
 * that job did before the field was there.
 */
interface VideoAnimationConfig extends ExtrasConfig {
  /** What the voiceover says, word for word. Required. */
  script?: string;
  style?: string;
  /** "Kling 3 Standard" or "Kling 3 Pro" -- see lib/klingClip.ts. */
  videoModel?: string;

  imageOutputFormat?: string;
  imageSafetyTolerance?: string;

  compositeOutputFormat?: string;
  compositeSafetyChecker?: boolean;
  mentionBusiness?: boolean;
}

function config(job: { config: unknown }): VideoAnimationConfig {
  return job.config as VideoAnimationConfig;
}

// ---------------------------------------------------------------- stage 0: the voiceover inputs

/** The voiceover step's output: the script as spoken, how long it ran, and the scene windows. */
function voiceOf(job: { steps: { id: string; output?: unknown }[] }): NarratedScript | undefined {
  return job.steps.find((s) => s.id === "voice")?.output as NarratedScript | undefined;
}

// ---------------------------------------------------------------- stage 1: the voiceover (P4)

/**
 * The whole script in one take, before anything is drawn or animated. How long
 * it takes to say (X seconds) decides how many scenes there are (X / 3, rounded
 * up), and the speech model's word timings say which words are spoken during
 * which scene -- see lib/scriptTiming.ts.
 *
 * This replaces the old per-shot dialogue: one continuous narration has one
 * continuous rhythm, and the clips are cut to it rather than the other way
 * round.
 */
export const recordVoiceover = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "voice", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);

    // Required: it is the video's only source of length and of story.
    const script = (cfg.script ?? "").trim();
    if (!script) throw new Error("A script is required.");

    // Before anything is spent: see assertVoiceoverSupport.
    await assertVoiceoverSupport();

    const narrated = await narrateScript(ctx, { jobId, clientId, script, config: cfg });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "voice",
      state: "done",
      output: narrated,
    });
    return null;
  },
});

/** The script laid out as numbered three-second scenes, for the steps that plan around it. */
function scenesText(voice: NarratedScript): string {
  return voice.windows
    .map((w, i) => `Scene ${i + 1} (${i * SCENE_SECONDS}-${(i + 1) * SCENE_SECONDS}s): ${w.trim() || "(a pause -- nothing is said)"}`)
    .join("\n");
}

// ---------------------------------------------------------------- stage 2: characters + backgrounds
const CHARACTERS_SYSTEM = `Read a narration script to extract the characters and locations it needs on
screen, then write detailed image-generation prompts for each.

The script is a voiceover read over generated footage, divided into numbered
scenes of three seconds each -- not a screenplay. Characters are the people or
creatures it talks about or that would naturally appear in what it describes.
If it is about things rather than people (a process, a place, an object, an
idea), the characters list may be EMPTY: the backgrounds carry the picture. Do
not invent a cast the script does not call for. Give the backgrounds real
variety -- at least two, more for a longer script -- so the shots do not all
look alike.

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
    const voice = voiceOf(job);
    if (!voice?.windows?.length) throw new Error("no voiceover to extract characters from");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.3 });

    const call = await callTool(
      CHARACTERS_SYSTEM,
      `Art direction: ${imageStyle}.\n\nScript, cut into scenes:\n\n${scenesText(voice)}`,
      CHARACTERS_TOOL as never,
    );
    const extracted = call.value as { characters?: Character[]; backgrounds?: Background[] };
    const characters = extracted.characters ?? [];
    const backgrounds = extracted.backgrounds ?? [];
    // Characters may legitimately be none (see the system prompt); a video
    // with no place to happen in cannot be.
    if (!backgrounds.length) throw new Error("model returned no backgrounds");

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
    const backgroundAspect = ratioOf(cfg.aspectRatio, "16:9");
    const imageFormat = cfg.imageOutputFormat ?? "png";
    const imageSafety = cfg.imageSafetyTolerance ?? "4";
    const [charImages, bgImages] = await Promise.all([
      Promise.all(
        characters.map(async (c) => {
          const buildInput = (prompt: string) => ({
            prompt,
            aspect_ratio: "1:1",
            output_format: imageFormat,
            safety_tolerance: imageSafety,
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
            output_format: imageFormat,
            safety_tolerance: imageSafety,
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
const SHOTS_SYSTEM = `Turn a narration script into a shot list, one shot for each numbered scene.

The video is cut to a voiceover that is already recorded. The script is divided
into numbered scenes of exactly three seconds each, and every scene is ONE shot:
shot N is on screen while scene N of the script is spoken, so it must show what
is being said in those three seconds. Write exactly one shot per scene, in
order -- no more and no fewer. The scene and shot count are given in the prompt;
use those numbers precisely, do not recompute them.

A scene with no words is a pause: carry the visual thread on from the shot
before it.

Group consecutive shots that happen in the same place into one story scene:
give them the same scene_number (starting at 1) and number them
shot_number_in_scene from 1. A change of place starts a new scene_number.

Assign sequential IDs: shot_001, shot_002, ...

For each shot:
- duration_seconds: 3, for every shot
- characters: list of character_id's present (must match the given characters;
  an empty list is fine for a shot with nobody in it)
- background: the bg_id for this location (must match the given backgrounds)
- action: clear visual description of what happens in this shot, in three seconds
- camera_movement: e.g. "static wide shot", "slow dolly-in", "pan left",
  "close-up on face", "tracking shot". One simple move: three seconds is short.
- dialogue: always "" -- the voiceover speaks the script
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

    // One shot per scene of the voiceover: X / 3, already worked out.
    const voice = voiceOf(job);
    if (!voice?.windows?.length) throw new Error("no voiceover to cut the shots to");
    const shotCount = voice.windows.length;

    const cast = job.steps.find((s) => s.id === "characters")?.output as
      | { characters?: Character[]; backgrounds?: Background[] }
      | undefined;
    const characters = cast?.characters ?? [];
    const backgrounds = cast?.backgrounds ?? [];
    if (!backgrounds.length) throw new Error("the cast must be approved before writing shots");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.1 });

    const prompt =
      `Target: exactly ${shotCount} shots of ${SCENE_SECONDS} seconds each ` +
      `(${shotCount * SCENE_SECONDS}s total), one for each scene below.\n` +
      `Art direction: ${imageStyle}.\n\n` +
      `Available characters:\n${JSON.stringify(
        characters.map((c) => ({ character_id: c.character_id, name: c.name, description: c.description })),
        null, 2,
      )}\n\n` +
      `Available backgrounds:\n${JSON.stringify(
        backgrounds.map((b) => ({ bg_id: b.bg_id, name: b.name, description: b.description })),
        null, 2,
      )}\n\n` +
      `Script, cut into scenes:\n\n${scenesText(voice)}` +
      (await businessContext(
        ctx,
        clientId,
        cfg.mentionBusiness,
        "Where it fits the script, show the business's product, setting or customers in the shots -- never as an ad.",
      ));

    const call = await callTool(SHOTS_SYSTEM, prompt, SHOTS_TOOL as never);
    const drafted = listFrom<Shot>(call.value, "shots");
    if (drafted.length < shotCount) {
      throw new Error(`model returned ${drafted.length} shot(s) for ${shotCount} scenes of the script`);
    }

    // One per scene, no more. And the parts the model has no say in are set
    // here rather than trusted: every shot is exactly three seconds, the words
    // shown with it are the ones actually spoken during it, and a background
    // or character it mistyped falls back to something real rather than
    // dropping the shot -- a dropped shot would leave a hole in the picture
    // while the voice carried on.
    const bgIds = new Set(backgrounds.map((b) => b.bg_id));
    const charIds = new Set(characters.map((c) => c.character_id));
    const shots: Shot[] = drafted.slice(0, shotCount).map((s, i) => ({
      ...s,
      shot_id: `shot_${String(i + 1).padStart(3, "0")}`,
      duration_seconds: SCENE_SECONDS,
      dialogue: voice.windows[i].trim(),
      background: bgIds.has(s.background) ? s.background : backgrounds[0].bg_id,
      characters: (s.characters ?? []).filter((id) => charIds.has(id)),
    }));

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
    const imageSize =
      ASPECT_TO_COMPOSITE_IMAGE_SIZE[ratioOf(cfg.aspectRatio, "16:9")] ?? "landscape_16_9";
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
          output_format: cfg.compositeOutputFormat ?? "jpeg",
          enable_safety_checker: cfg.compositeSafetyChecker !== false,
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
      Math.min(MAX_CLIP_SECONDS, s.duration_seconds || SCENE_SECONDS);
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

// ---------------------------------------------------------------- stage 7: stitch (P7)
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const cfg = config(job);
    const shots = ((job.steps.find((s) => s.id === "clips")?.output as { shots?: Shot[] } | undefined)
      ?.shots ?? []) as Shot[];
    if (!shots.length) throw new Error("no shots to stitch");
    // The one continuous voiceover the whole cut was built around.
    const voiceoverUrl = voiceOf(job)?.audioUrl;
    if (!voiceoverUrl) throw new Error("missing voiceover");

    const base = renderServiceBase();
    const musicUrl =
      (job.steps.find((s) => s.id === "music")?.output as { url?: string } | undefined)?.url ??
      null;
    // Start/end videos and the branded cards ride on this same render call.
    const { startVideoUrl, endVideoUrl, branding } = await bookendsAndBranding(ctx, cfg);

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
          // Silent: the voiceover is one track laid across the whole cut.
          audioUrl: null,
          durationSec: s.duration_seconds || SCENE_SECONDS,
          // No text of its own: the only words on screen are the subtitles,
          // transcribed from the voiceover in the step after this one.
        })),
        dimensions: ratioOf(cfg.aspectRatio, "16:9"),
        voiceoverUrl,
        musicUrl,
        musicVolume: musicVolumeOf(cfg),
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

// ---------------------------------------------------------------- optional: music, upscale, subtitles

/** The finished cut's length: one three-second shot for each scene of the voiceover. */
function totalSecondsOf(job: { steps: { id: string; output?: unknown }[] }): number {
  return (voiceOf(job)?.sceneCount ?? 0) * SCENE_SECONDS;
}

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
    const cfg = config(job);
    const voice = voiceOf(job);
    if (!voice) throw new Error("nothing to score");
    await scoreMusicStep(ctx, {
      jobId,
      clientId,
      wantedSeconds: voice.seconds,
      subject: voice.script.slice(0, 300),
    });
    return null;
  },
});

export const upscale = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    await upscaleStep(ctx, { jobId, clientId, fallbackSeconds: totalSecondsOf(job) });
    return null;
  },
});

export const burnSubtitles = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    await subtitlesStep(ctx, {
      jobId,
      clientId,
      fallbackSeconds: totalSecondsOf(job),
      defaultAspect: "16:9",
    });
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
