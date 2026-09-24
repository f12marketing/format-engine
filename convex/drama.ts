import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import {
  callSync,
  callTool,
  pollQueued,
  rewritePromptNeutrally,
  submitAndPoll,
  submitQueued,
  submitWithContentPolicyFallback,
} from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { resolveRosterPersona } from "./lib/roster";
import { businessContext } from "./lib/businessContext";

/**
 * Drama: premise -> episode -> cast -> storyboard -> dialogue -> filmed
 * beats -> score -> final cut.
 *
 * The production line is DramaClaw's (github.com/dramaclaw/dramaclaw), with
 * the models its recommended profile uses, all served by fal. Only the design
 * is borrowed: DramaClaw is Elastic License 2.0, which rules out offering it
 * to clients as a hosted service, so nothing below is copied from it --
 * prompts, schemas and code are all written for this app.
 *
 * The step that makes it drama is filming. Each beat goes to Seedance 2.0 in
 * reference mode with the storyboard frame, the reference sheet of everyone
 * on screen, and the beat's own recorded line: the clip comes back with the
 * line spoken, lip-synced, in that character's cloned voice. That is why the
 * dialogue is recorded (IndexTTS-2, cloning a per-character sample) BEFORE
 * filming rather than dubbed over it afterwards like Video Animation does.
 *
 * Filming is also the first step in the app that can't live inside one
 * action. A 15-second Seedance clip queued behind others can outlast the
 * 10-minute action ceiling, and `submitAndPoll`'s answer -- time out and let
 * the retry resubmit -- would pay for that clip twice. So each beat is its
 * own branch of the workflow: one step submits, later steps poll, and
 * running out of time means "poll again", never "submit again".
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const { jobId } = args;
    try {
      await step.runAction(internal.drama.writeScript, args, { retry: true });
      await passGate(step, jobId, "script");

      await step.runAction(internal.drama.castCharacters, args, { retry: true });
      await passGate(step, jobId, "cast");

      await step.runAction(internal.drama.drawStoryboard, args, { retry: true });
      await passGate(step, jobId, "storyboard");

      await step.runAction(internal.drama.recordVoices, args, { retry: true });

      const beats = await step.runAction(internal.drama.beginFilming, args, { retry: true });
      await Promise.all(beats.map((beat) => filmBeat(step, args, beat)));
      await step.runMutation(internal.jobs.patchStep, { jobId, stepId: "scenes", state: "done" });

      // Music is the one optional step -- "None" leaves it out of the job's
      // plan entirely, which is what `plannedStepIds` reports.
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId });
      if (planned.includes("music")) {
        await step.runAction(internal.drama.scoreMusic, args, { retry: true });
      }

      await step.runAction(internal.drama.finalCut, args, { retry: true });
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

async function passGate(step: WorkflowCtx, jobId: Id<"jobs">, stepId: string): Promise<void> {
  await step.awaitEvent({ name: `approve:${jobId}:${stepId}` });
  await step.runMutation(internal.jobs.patchStep, { jobId, stepId, state: "done" });
  await step.runMutation(internal.jobs.setRunning, { jobId });
}

/**
 * One beat, start to finish: submit, poll until it lands, and walk the same
 * three-rung prompt ladder every other generation step uses if fal's
 * content checker rejects it.
 */
const PROMPT_VARIANTS = ["original", "reworded", "minimal"] as const;
/** Each poll step spends up to POLL_BUDGET_MS, so this caps a beat at ~40 minutes. */
const MAX_POLLS_PER_SUBMIT = 8;

async function filmBeat(
  step: WorkflowCtx,
  args: { jobId: Id<"jobs">; clientId: Id<"clients"> },
  beat: number,
): Promise<void> {
  for (const variant of PROMPT_VARIANTS) {
    const handle = await step.runAction(
      internal.drama.submitBeatClip,
      { ...args, beat, variant },
      { retry: true },
    );
    let state: "done" | "pending" | "policy" = "pending";
    for (let poll = 0; poll < MAX_POLLS_PER_SUBMIT && state === "pending"; poll += 1) {
      state = await step.runAction(
        internal.drama.pollBeatClip,
        { ...args, beat, ...handle },
        { retry: true },
      );
    }
    if (state === "done") return;
    if (state === "pending") {
      throw new Error(
        `Beat ${beat} was still rendering on fal after ~40 minutes. ` +
          "fal may be backed up -- retry the job later.",
      );
    }
  }
  throw new Error(
    `fal's content checker rejected beat ${beat} on all three prompt variants ` +
      "(original, reworded, minimal). Soften that beat's line or action and run it again.",
  );
}

// ---------------------------------------------------------------- models and pricing

/** DramaClaw's recommended text model, via fal's OpenRouter passthrough. */
const DRAMA_LLM = "openai/gpt-5.6-luna";
const LLM_INPUT_PER_1M = 0.2;
const LLM_OUTPUT_PER_1M = 1.2;

const NANO_BANANA = "fal-ai/nano-banana-2";
const NANO_BANANA_EDIT = "fal-ai/nano-banana-2/edit";
const GPT_IMAGE_EDIT = "openai/gpt-image-2/edit";
const IMAGE_PRICE = 0.08; // nano-banana-2 at 1K, flat
/**
 * gpt-image-2 bills by tokens, not per image. At medium quality a portrait
 * frame with a handful of reference images lands around nano-banana's flat
 * rate, so the same figure is used -- a floor, like every rate in this app.
 */
const GPT_IMAGE_FRAME_PRICE = 0.08;

const VOICE_SAMPLE_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";
const VOICE_SAMPLE_PER_1000_CHARS = 0.1;
const INDEX_TTS = "fal-ai/index-tts-2/text-to-speech";
const INDEX_TTS_PER_SEC = 0.002;

const SEEDANCE_MODELS: Record<string, string> = {
  "Seedance 2.0 Fast": "bytedance/seedance-2.0/fast/reference-to-video",
  "Seedance 2.0": "bytedance/seedance-2.0/reference-to-video",
};
/**
 * fal bills Seedance by tokens -- pixels x seconds x 24 / 1024 -- and quotes
 * the 720p result per second; 480p is the same formula at 864x496. Aspect
 * barely moves it, since Seedance keeps the pixel count roughly constant
 * across ratios. Mirrored in src/lib/estimate.ts.
 */
const SEEDANCE_PER_SEC: Record<string, Record<string, number>> = {
  "bytedance/seedance-2.0/fast/reference-to-video": { "720p": 0.2419, "480p": 0.1125 },
  "bytedance/seedance-2.0/reference-to-video": { "720p": 0.3034, "480p": 0.1406 },
};

const MUSIC_MODEL = "fal-ai/elevenlabs/music";
/** Billed per started minute. */
const MUSIC_PER_MINUTE = 0.6;

function llmCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * LLM_INPUT_PER_1M + (outputTokens / 1e6) * LLM_OUTPUT_PER_1M;
}

// ---------------------------------------------------------------- types

interface DramaCharacter {
  id: string;
  name: string;
  role: string;
  gender: "female" | "male" | "nonbinary";
  age: string;
  look: string;
  wardrobe: string;
  voice_preset: string;
  sample_line: string;
  is_lead?: boolean;
  image_url?: string;
  voice_url?: string;
}

interface DramaLocation {
  id: string;
  name: string;
  description: string;
  image_url?: string;
}

interface DramaBeat {
  n: number;
  location: string;
  characters: string[];
  kind: "dialogue" | "narration" | "action";
  /** A character id for dialogue, "narrator" for narration, "" for action. */
  speaker: string;
  line: string;
  emotion: string;
  action: string;
  camera: string;
  seconds: number;
  frame_prompt?: string;
  motion_prompt?: string;
  frame_url?: string;
  audio_url?: string;
  audio_sec?: number;
  clip_url?: string;
}

interface DramaEpisode {
  title: string;
  logline: string;
  score: string;
  narrator_voice: string;
  narrator_voice_url?: string;
  aspectRatio: string;
  characters: DramaCharacter[];
  locations: DramaLocation[];
  beats: DramaBeat[];
  music_url?: string;
}

interface DramaConfig {
  premise?: string;
  genre?: string;
  style?: string;
  durationSec?: number;
  aspectRatio?: string;
  lead?: string | null;
  videoModel?: string;
  resolution?: string;
  storyboardModel?: string;
  music?: string;
  captionOverlay?: boolean;
  captionStyle?: string;
  language?: string;
  mentionBusiness?: boolean;
}

function config(job: { config: unknown }): DramaConfig {
  return job.config as DramaConfig;
}

type JobDoc = { steps: { id: string; output?: unknown }[]; config: unknown };

/** Each step hands the whole episode forward, so a step reads its predecessor's copy. */
function episodeFrom(job: JobDoc, stepId: string): DramaEpisode {
  const ep = job.steps.find((s) => s.id === stepId)?.output as DramaEpisode | undefined;
  if (!ep?.beats?.length) throw new Error(`the ${stepId} step has no episode to continue from`);
  return ep;
}

async function loadJob(ctx: ActionCtx, jobId: Id<"jobs">) {
  const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
  if (!job) throw new Error("unknown job");
  return job;
}

function charById(ep: DramaEpisode): Map<string, DramaCharacter> {
  return new Map(ep.characters.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------- art direction

/**
 * Six looks, matching the six style families DramaClaw ships presets for.
 * Written for this app: `look` is appended to every image prompt, `avoid`
 * closes it.
 */
const STYLES: Record<string, { look: string; avoid: string }> = {
  Realistic: {
    look:
      "Live-action film still. Natural, motivated lighting; true-to-life skin with visible " +
      "texture; 35-50mm cinema lens with shallow depth of field; subtle grain and a restrained, " +
      "filmic colour grade.",
    avoid:
      "Not illustrated, not animated, not a 3D render. No waxy or airbrushed skin, no distorted " +
      "hands or faces, no text, captions or watermarks.",
  },
  Anime: {
    look:
      "Modern Japanese TV-anime frame. Clean line art, cel shading with soft gradients, " +
      "expressive eyes, painted backgrounds with atmospheric depth, dramatic cinematic lighting.",
    avoid:
      "Not photographic, not 3D CGI. No off-model faces, no extra fingers, no text, captions " +
      "or watermarks.",
  },
  "Period drama": {
    look:
      "Live-action historical costume drama. Layered silks and fine embroidery, lacquered wood " +
      "and paper screens, warm lantern and candle light, rich jewel-tone grade, composed " +
      "classical framing.",
    avoid:
      "No modern objects, clothing or signage. Not illustrated. No text, captions or watermarks.",
  },
  "Fantasy epic": {
    look:
      "High-fantasy live-action epic. Grand sweeping sets, ornate armour and flowing robes, " +
      "volumetric light through mist, magical glow used sparingly, cinematic teal-and-gold grade.",
    avoid:
      "No modern objects. No cartoonish proportions. No text, captions or watermarks.",
  },
  "Post-apocalyptic": {
    look:
      "Gritty post-apocalyptic live action. Ruined concrete, rust and dust, scavenged layered " +
      "clothing, harsh sun or sodium light, desaturated warm grade with deep shadows.",
    avoid:
      "No clean or pristine surfaces. Not illustrated. No text, captions or watermarks.",
  },
  "1930s noir": {
    look:
      "1930s period noir, live action. Tailored suits and cloche hats, art-deco interiors, " +
      "hard light through venetian blinds, smoky haze, muted sepia-and-teal grade.",
    avoid: "No modern objects or clothing. No text, captions or watermarks.",
  },
};

function styleFor(cfg: DramaConfig) {
  return STYLES[cfg.style ?? ""] ?? STYLES.Realistic;
}

const GPT_IMAGE_SIZE: Record<string, string> = {
  "9:16": "portrait_16_9",
  "16:9": "landscape_16_9",
  "1:1": "square_hd",
};

/**
 * ElevenLabs' premade voices, described so the writer can cast them. These
 * only seed each character's voice: DramaClaw expects a recorded sample per
 * character, which this app has no library of, so a short ElevenLabs read
 * stands in as the sample and IndexTTS-2 clones it for every actual line.
 */
const VOICE_PRESETS: Record<string, { gender: "female" | "male" | "neutral"; notes: string }> = {
  Rachel: { gender: "female", notes: "calm, young adult, American" },
  Sarah: { gender: "female", notes: "soft and warm, young adult, American" },
  Laura: { gender: "female", notes: "bright and quirky, young, American" },
  Charlotte: { gender: "female", notes: "sultry, self-assured, Swedish-English" },
  Alice: { gender: "female", notes: "clear and composed, British" },
  Matilda: { gender: "female", notes: "warm and friendly, mature, American" },
  Jessica: { gender: "female", notes: "expressive and playful, young, American" },
  Lily: { gender: "female", notes: "velvety actress, mature, British" },
  Aria: { gender: "female", notes: "husky and expressive, middle-aged, American" },
  Roger: { gender: "male", notes: "confident and easygoing, American" },
  Charlie: { gender: "male", notes: "natural, young, Australian" },
  George: { gender: "male", notes: "warm storyteller, mature, British" },
  Callum: { gender: "male", notes: "intense and husky, Transatlantic" },
  Liam: { gender: "male", notes: "articulate, young, American" },
  Will: { gender: "male", notes: "friendly, young, American" },
  Eric: { gender: "male", notes: "smooth and polished, middle-aged, American" },
  Chris: { gender: "male", notes: "casual, down-to-earth, American" },
  Brian: { gender: "male", notes: "deep and resonant, middle-aged, American" },
  Daniel: { gender: "male", notes: "authoritative, British" },
  Bill: { gender: "male", notes: "gravelly and weathered, older, American" },
  River: { gender: "neutral", notes: "relaxed, gender-neutral, American" },
};

function fallbackVoice(gender: string): string {
  return gender === "male" ? "Roger" : gender === "female" ? "Sarah" : "River";
}

// ---------------------------------------------------------------- stage 1: the episode (P1)

const SCRIPT_SYSTEM = `You are the head writer of a vertical short-drama studio. You turn a premise into ONE self-contained episode, told in beats, built to stop a thumb mid-scroll.

Craft:
- Beat 1 is the hook. Open in the middle of the conflict, on its most charged moment -- no establishing preamble.
- Every beat changes something: a reveal, a reversal, a shift in who holds the power. Escalate to the end.
- The final beat is a cliffhanger: cut on the line or image that makes the next episode unmissable.
- A small cast (2-4 named characters) and 1-3 locations.
- Dialogue is short and spoken, specific to this person at this moment. At most 20 words per line, one speaker per beat. Nothing that could be dropped unchanged into another story ("This changes everything", "We need to talk").
- Narration sparingly -- at most 2 beats -- for an inner voice or a time jump.
- Show, don't tell. Action beats carry the reactions: a glance, a hand that stops, an object that gives someone away.

Beats:
- kind "dialogue": speaker is the id of the character talking, who must also be in that beat's characters. line is exactly and only what they say aloud -- no stage directions, no quotation marks.
- kind "narration": speaker "narrator"; line is the voice-over.
- kind "action": speaker "" and line "".
- emotion: how the line lands or what the moment feels like, in a few words ("icy, barely controlled", "a stunned whisper").
- action: what the camera sees -- who does what, expressions, key objects. Refer to characters by name.
- camera: shot size and movement ("slow push-in on her face", "static wide two-shot", "handheld over-the-shoulder").
- characters: ids of everyone visible, at most 3.
- seconds: 4-15. A dialogue beat needs about 1 second per 2.5 words, plus a moment to react.

Characters:
- look: fixed physical identity -- age, ethnicity, face shape, eyes, hair colour, length and style, build, any distinguishing mark. Specific enough that two artists would draw the same person.
- wardrobe: exactly what they wear in this episode, with colours.
- voice_preset: the closest match from the preset list for their gender, age and personality. No two speaking characters share one.
- sample_line: 10-16 words this character might say in a calm moment; it is used to capture their voice.

Also give the episode a short, punchy title; a one-sentence logline; and score, a one-line brief for its instrumental background music (instruments, tempo, mood).`;

function scriptTool(voiceIds: string[]) {
  return {
    name: "save_episode",
    description: "Save the finished short-drama episode.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        logline: { type: "string" },
        score: { type: "string" },
        narrator_voice: {
          type: "string",
          enum: voiceIds,
          description: "Preset for the narrator, used only if a beat is narration.",
        },
        characters: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^c\\d+$" },
              name: { type: "string" },
              role: { type: "string", description: "Their part in the story, e.g. 'the jilted bride'." },
              gender: { type: "string", enum: ["female", "male", "nonbinary"] },
              age: { type: "string" },
              look: { type: "string" },
              wardrobe: { type: "string" },
              voice_preset: { type: "string", enum: voiceIds },
              sample_line: { type: "string" },
            },
            required: [
              "id", "name", "role", "gender", "age", "look", "wardrobe", "voice_preset", "sample_line",
            ],
          },
        },
        locations: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^l\\d+$" },
              name: { type: "string" },
              description: {
                type: "string",
                description: "The place itself, empty of people: architecture, props, light, time of day.",
              },
            },
            required: ["id", "name", "description"],
          },
        },
        beats: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            properties: {
              n: { type: "integer" },
              location: { type: "string" },
              characters: { type: "array", items: { type: "string" } },
              kind: { type: "string", enum: ["dialogue", "narration", "action"] },
              speaker: { type: "string" },
              line: { type: "string" },
              emotion: { type: "string" },
              action: { type: "string" },
              camera: { type: "string" },
              seconds: { type: "integer", minimum: 4, maximum: 15 },
            },
            required: [
              "n", "location", "characters", "kind", "speaker", "line", "emotion", "action", "camera", "seconds",
            ],
          },
        },
      },
      required: ["title", "logline", "score", "narrator_voice", "characters", "locations", "beats"],
    },
  };
}

function clampSeconds(n: unknown): number {
  const s = Math.round(Number(n) || 6);
  return Math.min(15, Math.max(4, s));
}

/**
 * Makes an episode safe to build on, whether it came from the model or from
 * a hand edit at the script gate: ids that resolve, speakers who are on
 * screen, kinds that agree with their lines, durations Seedance accepts.
 * Repairs rather than rejects -- a stray id is not worth failing a run over.
 */
function normalizeEpisode(raw: DramaEpisode, aspectRatio: string, hasLead: boolean): DramaEpisode {
  const characters = (raw.characters ?? []).slice(0, 4).map((c, i) => ({
    ...c,
    id: c.id || `c${i + 1}`,
    voice_preset: VOICE_PRESETS[c.voice_preset] ? c.voice_preset : fallbackVoice(c.gender),
    is_lead: hasLead && i === 0,
  }));
  const charIds = new Set(characters.map((c) => c.id));
  const locations = (raw.locations ?? []).slice(0, 3).map((l, i) => ({ ...l, id: l.id || `l${i + 1}` }));
  if (!characters.length || !locations.length) {
    throw new Error("the episode needs at least one character and one location");
  }
  const locIds = new Set(locations.map((l) => l.id));

  const beats = (raw.beats ?? []).map((b, i): DramaBeat => {
    const onScreen = (b.characters ?? []).filter((id) => charIds.has(id));
    let kind = b.kind;
    let speaker = (b.speaker ?? "").trim();
    const line = (b.line ?? "").trim();

    if (kind === "dialogue") {
      if (!line || !charIds.has(speaker)) {
        kind = "action";
      } else if (!onScreen.includes(speaker)) {
        onScreen.unshift(speaker);
      }
    }
    if (kind === "narration" && !line) kind = "action";
    if (kind === "narration") speaker = "narrator";
    if (kind === "action") speaker = "";

    return {
      ...b,
      n: i + 1,
      location: locIds.has(b.location) ? b.location : locations[0].id,
      characters: onScreen.slice(0, 3),
      kind,
      speaker,
      line: kind === "action" ? "" : line,
      emotion: b.emotion ?? "",
      action: b.action ?? "",
      camera: b.camera ?? "",
      seconds: clampSeconds(b.seconds),
    };
  });
  if (!beats.length) throw new Error("the episode has no beats");

  return {
    title: raw.title ?? "Untitled",
    logline: raw.logline ?? "",
    score: raw.score ?? "",
    narrator_voice: VOICE_PRESETS[raw.narrator_voice] ? raw.narrator_voice : "George",
    narrator_voice_url: raw.narrator_voice_url,
    aspectRatio,
    characters,
    locations,
    beats,
    music_url: raw.music_url,
  };
}

export const writeScript = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "script", state: "running" });

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const premise = (cfg.premise ?? "").trim();
    if (!premise) throw new Error("A premise or script is required.");
    const targetSeconds = cfg.durationSec ?? 45;
    const beatCount = Math.min(15, Math.max(5, Math.round(targetSeconds / 6)));
    const aspectRatio = cfg.aspectRatio ?? "9:16";

    // The lead's look comes from the chosen influencer, so the writer
    // describes the person who will actually be on screen.
    const lead = cfg.lead ? await resolveRosterPersona(ctx, cfg.lead, { clientId, jobId }) : null;

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.05 });

    const voiceIds = Object.keys(VOICE_PRESETS);
    const prompt =
      `Premise:\n${premise}\n\n` +
      `Genre: ${cfg.genre ?? "Revenge"}.\n` +
      `Visual style: ${cfg.style ?? "Realistic"}.\n` +
      `Target length: about ${targetSeconds} seconds, so about ${beatCount} beats whose seconds add up to roughly ${targetSeconds}.\n` +
      `Frame: ${aspectRatio}${aspectRatio === "9:16" ? " vertical, so favour close-ups and medium shots" : ""}.\n` +
      "Write every line of dialogue and narration in English.\n" +
      (lead
        ? `The lead character must be c1, played by this actor -- keep c1's look true to them: ${lead.description}\n`
        : "") +
      (cfg.mentionBusiness
        ? (await businessContext(
            ctx,
            clientId,
            true,
            "Work the client's business into the story naturally -- a place, a product a character uses -- never as an ad read.",
          )).trimStart() + "\n"
        : "") +
      `\nVoice presets:\n${voiceIds.map((id) => `- ${id}: ${VOICE_PRESETS[id].gender}, ${VOICE_PRESETS[id].notes}`).join("\n")}`;

    const call = await callTool(SCRIPT_SYSTEM, prompt, scriptTool(voiceIds) as never, { model: DRAMA_LLM });
    const episode = normalizeEpisode(call.value as DramaEpisode, aspectRatio, Boolean(lead));

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "script",
      primitive: "P1",
      model: DRAMA_LLM,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call.inputTokens, call.outputTokens),
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "script",
      output: episode,
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 2: cast and sets (P2)

function speakingCharacterIds(ep: DramaEpisode): Set<string> {
  return new Set(ep.beats.filter((b) => b.kind === "dialogue").map((b) => b.speaker));
}

async function generateVoiceSample(preset: string, gender: string, text: string): Promise<string> {
  const read = async (voice: string) =>
    (await callSync(VOICE_SAMPLE_MODEL, {
      text,
      voice,
      stability: 0.5,
      language_code: "en",
      apply_text_normalization: "auto",
    })) as { audio?: { url?: string } };
  let result: { audio?: { url?: string } };
  try {
    result = await read(preset);
  } catch {
    // A preset fal's ElevenLabs build doesn't know is not worth failing the
    // cast over -- the default voice for that gender still gives a sample.
    result = await read(fallbackVoice(gender));
  }
  const url = result.audio?.url;
  if (!url) throw new Error("no audio returned for a voice sample");
  return url;
}

export const castCharacters = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "cast", state: "running" });

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const style = styleFor(cfg);
    const lead = cfg.lead ? await resolveRosterPersona(ctx, cfg.lead, { clientId, jobId }) : null;
    // Re-normalised: the approved script may have been hand-edited at the gate.
    const ep = normalizeEpisode(episodeFrom(job, "script"), cfg.aspectRatio ?? "9:16", Boolean(lead));

    const speaking = speakingCharacterIds(ep);
    const needsNarrator = ep.beats.some((b) => b.kind === "narration");
    const imageCount = ep.characters.length + ep.locations.length;
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: imageCount * IMAGE_PRICE + 0.05,
    });

    // Full-body reference sheets at 3:4 -- every storyboard frame and every
    // filmed beat reuses these, so this is where identity is fixed.
    const castImages = Promise.all(
      ep.characters.map(async (c) => {
        const sheet =
          `Full-body character reference sheet of ${c.name}: ${c.gender}, ${c.age}. ${c.look} ` +
          `Wearing ${c.wardrobe}. Standing straight, facing camera, neutral expression, arms relaxed, ` +
          `plain light-grey studio background, even soft lighting. ${style.look} ${style.avoid}`;
        const minimal = () =>
          `Full-body character reference sheet, ${c.gender}, ${c.age}, standing, neutral pose, ` +
          `plain background, soft even lighting. ${style.look}`;

        let result: { images?: { url?: string }[] };
        if (c.is_lead && lead) {
          // The influencer's own photo drives the face; the sheet only
          // changes what they're wearing and how they're framed.
          result = (await submitWithContentPolicyFallback(
            NANO_BANANA_EDIT,
            (prompt) => ({
              prompt,
              image_urls: [lead.imageUrl],
              aspect_ratio: "3:4",
              output_format: "png",
              safety_tolerance: "4",
              num_images: 1,
            }),
            `The same person as in the reference photo -- keep their face, skin tone, hair and build exactly. ${sheet}`,
            () => `The same person as in the reference photo. ${minimal()}`,
          )) as { images?: { url?: string }[] };
        } else {
          result = (await submitWithContentPolicyFallback(
            NANO_BANANA,
            (prompt) => ({
              prompt,
              aspect_ratio: "3:4",
              output_format: "png",
              safety_tolerance: "4",
              num_images: 1,
            }),
            sheet,
            minimal,
          )) as { images?: { url?: string }[] };
        }
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no reference image returned for ${c.name}`);
        return url;
      }),
    );

    const setImages = Promise.all(
      ep.locations.map(async (l) => {
        const result = (await submitWithContentPolicyFallback(
          NANO_BANANA,
          (prompt) => ({
            prompt,
            aspect_ratio: ep.aspectRatio,
            output_format: "png",
            safety_tolerance: "4",
            num_images: 1,
          }),
          `${l.name}: ${l.description} Empty establishing shot, no people. ${style.look} ${style.avoid}`,
          () => `${l.name}, empty establishing shot, no people. ${style.look}`,
        )) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no image returned for location ${l.name}`);
        return url;
      }),
    );

    // Only characters who actually speak get a voice; a silent extra
    // doesn't need one.
    const voiceChars = ep.characters.filter((c) => speaking.has(c.id));
    const narratorSample = "Every family keeps one secret. Tonight, this one finally comes out.";
    const voices = Promise.all(
      voiceChars.map((c) => generateVoiceSample(c.voice_preset, c.gender, c.sample_line)),
    );
    const narratorVoice = needsNarrator
      ? generateVoiceSample(ep.narrator_voice, "neutral", narratorSample)
      : Promise.resolve(undefined);

    const [charUrls, setUrls, voiceUrls, narratorUrl] = await Promise.all([
      castImages,
      setImages,
      voices,
      narratorVoice,
    ]);

    const voiceById = new Map(voiceChars.map((c, i) => [c.id, voiceUrls[i]]));
    const cast: DramaEpisode = {
      ...ep,
      narrator_voice_url: narratorUrl,
      characters: ep.characters.map((c, i) => ({
        ...c,
        image_url: charUrls[i],
        voice_url: voiceById.get(c.id),
      })),
      locations: ep.locations.map((l, i) => ({ ...l, image_url: setUrls[i] })),
    };

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "cast",
      primitive: "P2",
      model: NANO_BANANA,
      units: imageCount,
      unitLabel: "images",
      costUsd: imageCount * IMAGE_PRICE,
    });
    const sampleChars =
      voiceChars.reduce((sum, c) => sum + c.sample_line.length, 0) +
      (needsNarrator ? narratorSample.length : 0);
    if (sampleChars > 0) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "cast",
        primitive: "P4",
        model: VOICE_SAMPLE_MODEL,
        units: sampleChars,
        unitLabel: "chars",
        costUsd: (sampleChars / 1000) * VOICE_SAMPLE_PER_1000_CHARS,
      });
    }
    await ctx.runMutation(internal.jobs.setAwaitingApproval, { jobId, stepId: "cast", output: cast });
    return null;
  },
});

// ---------------------------------------------------------------- stage 3: storyboard (P2)

const DIRECTOR_SYSTEM = `You are the director of a short drama, preparing each beat for two generators.

For every beat write:
- frame_prompt: the single still that OPENS the beat, for an image model that is given the location and each on-screen character's reference sheet. Describe composition and staging -- who stands where, facing whom, posture, expression, what's in their hands, shot size, lens feel, light. Refer to characters by name. Don't describe their faces or clothes; the reference sheets carry that.
- motion_prompt: what happens DURING the beat, for a video model that starts from that still. Performance first -- gestures, a turn of the head, a reaction building -- then how the camera moves. Refer to characters by name. Don't re-describe how anyone or anything looks, and don't quote the dialogue.

Keep continuity: a character's position and props carry from one beat to the next unless the beat changes them.`;

const DIRECTOR_TOOL = {
  name: "save_direction",
  description: "Save the frame and motion direction for every beat.",
  input_schema: {
    type: "object",
    properties: {
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer" },
            frame_prompt: { type: "string" },
            motion_prompt: { type: "string" },
          },
          required: ["n", "frame_prompt", "motion_prompt"],
        },
      },
    },
    required: ["beats"],
  },
};

export const drawStoryboard = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "storyboard", state: "running" });

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const style = styleFor(cfg);
    const ep = episodeFrom(job, "cast");
    const chars = charById(ep);
    const locs = new Map(ep.locations.map((l) => [l.id, l]));
    const useGpt = (cfg.storyboardModel ?? "GPT Image 2") === "GPT Image 2";
    const frameModel = useGpt ? GPT_IMAGE_EDIT : NANO_BANANA_EDIT;
    const framePrice = useGpt ? GPT_IMAGE_FRAME_PRICE : IMAGE_PRICE;

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: ep.beats.length * framePrice + 0.02,
    });

    const brief = {
      style: cfg.style ?? "Realistic",
      frame: ep.aspectRatio,
      characters: ep.characters.map((c) => ({ id: c.id, name: c.name, role: c.role })),
      locations: ep.locations.map((l) => ({ id: l.id, name: l.name, description: l.description })),
      beats: ep.beats.map((b) => ({
        n: b.n,
        location: b.location,
        characters: b.characters.map((id) => chars.get(id)?.name ?? id),
        kind: b.kind,
        speaker: chars.get(b.speaker)?.name ?? b.speaker,
        line: b.line,
        emotion: b.emotion,
        action: b.action,
        camera: b.camera,
        seconds: b.seconds,
      })),
    };
    const call = await callTool(
      DIRECTOR_SYSTEM,
      `Episode: ${ep.title} -- ${ep.logline}\n\n${JSON.stringify(brief, null, 2)}`,
      DIRECTOR_TOOL as never,
      { model: DRAMA_LLM },
    );
    const direction = new Map(
      ((call.value as { beats?: { n: number; frame_prompt: string; motion_prompt: string }[] }).beats ?? [])
        .map((d) => [d.n, d]),
    );

    const framed = await Promise.all(
      ep.beats.map(async (b) => {
        const loc = locs.get(b.location);
        const onScreen = b.characters
          .map((id) => chars.get(id))
          .filter((c): c is DramaCharacter => Boolean(c?.image_url));
        const imageUrls = [loc?.image_url, ...onScreen.map((c) => c.image_url)].filter(
          (u): u is string => Boolean(u),
        );
        const d = direction.get(b.n);
        const frame_prompt = d?.frame_prompt || b.action;
        const motion_prompt = d?.motion_prompt || b.action;

        const refs =
          (loc?.image_url ? "Image 1 is the location. " : "") +
          onScreen
            .map((c, i) => `Image ${i + (loc?.image_url ? 2 : 1)} is ${c.name}'s reference sheet.`)
            .join(" ");
        const wrap = (body: string) =>
          `A single cinematic film still, ${ep.aspectRatio} frame, from a short drama. ${refs} ${body} ` +
          "Keep every person's face, hair, build and costume exactly as in their reference sheet, " +
          `and keep the location's layout. ${style.look} ${style.avoid}`;

        const buildInput = (prompt: string) =>
          useGpt
            ? {
                prompt,
                image_urls: imageUrls,
                image_size: GPT_IMAGE_SIZE[ep.aspectRatio] ?? "portrait_16_9",
                quality: "medium",
                output_format: "jpeg",
                num_images: 1,
              }
            : {
                prompt,
                image_urls: imageUrls,
                aspect_ratio: ep.aspectRatio,
                output_format: "jpeg",
                safety_tolerance: "4",
                num_images: 1,
              };

        const result = (await submitWithContentPolicyFallback(
          frameModel,
          buildInput,
          wrap(frame_prompt),
          () => wrap(`${onScreen.map((c) => c.name).join(" and ") || "The scene"}, ${b.camera || "medium shot"}. Mood: ${b.emotion || "tense"}.`),
        )) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no storyboard frame returned for beat ${b.n}`);
        return { ...b, frame_prompt, motion_prompt, frame_url: url };
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "storyboard",
      primitive: "P1",
      model: DRAMA_LLM,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call.inputTokens, call.outputTokens),
    });
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "storyboard",
      primitive: "P2",
      model: frameModel,
      units: framed.length,
      unitLabel: "images",
      costUsd: framed.length * framePrice,
    });
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "storyboard",
      output: { ...ep, beats: framed },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 4: dialogue (P4)

/** Seedance takes at most 15s of reference audio per clip. */
const MAX_REFERENCE_AUDIO_SEC = 15;

async function measureAudio(url: string, line: string): Promise<number> {
  try {
    const res = await fetch(`${renderServiceBase()}/inspect/video`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({ videoUrl: url }),
    });
    if (res.ok) {
      const { durationSec } = (await res.json()) as { durationSec?: number };
      if (durationSec && durationSec > 0) return durationSec;
    }
  } catch {
    // Fall through to the estimate: a wrong guess only costs a little padding.
  }
  const words = line.trim().split(/\s+/).length;
  return words / 2.5 + 0.5;
}

export const recordVoices = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "voices", state: "running" });

    const job = await loadJob(ctx, jobId);
    const ep = episodeFrom(job, "storyboard");
    const chars = charById(ep);

    const spoken = ep.beats.filter((b) => b.kind !== "action" && b.line);
    const estimatedSec = spoken.reduce((sum, b) => sum + b.line.split(/\s+/).length / 2.5, 0);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: estimatedSec * INDEX_TTS_PER_SEC * 1.5,
    });

    const voiced = await Promise.all(
      ep.beats.map(async (b): Promise<DramaBeat> => {
        if (b.kind === "action" || !b.line) return b;
        const reference =
          b.kind === "narration" ? ep.narrator_voice_url : chars.get(b.speaker)?.voice_url;
        if (!reference) throw new Error(`beat ${b.n} has no voice to speak its line with`);

        // IndexTTS-2 clones the sample's timbre and takes its delivery from
        // the beat's emotion note -- the same pairing DramaClaw relies on.
        const result = (await submitAndPoll(
          INDEX_TTS,
          {
            audio_url: reference,
            prompt: b.line,
            emotion_prompt: b.emotion || undefined,
            should_use_prompt_for_emotion: true,
          },
          { timeoutMs: 6 * 60_000 },
        )) as { audio?: { url?: string } };
        const url = result.audio?.url;
        if (!url) throw new Error(`no audio returned for beat ${b.n}`);

        const audioSec = await measureAudio(url, b.line);
        // The clip has to be long enough to hold its line, with a breath
        // after it for the reaction.
        const seconds = Math.min(15, Math.max(b.seconds, Math.ceil(audioSec + 0.8)));
        return { ...b, audio_url: url, audio_sec: audioSec, seconds };
      }),
    );

    const totalSec = voiced.reduce((sum, b) => sum + (b.audio_sec ?? 0), 0);
    if (totalSec > 0) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "voices",
        primitive: "P4",
        model: INDEX_TTS,
        units: Math.round(totalSec),
        unitLabel: "seconds",
        costUsd: totalSec * INDEX_TTS_PER_SEC,
      });
    }
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "voices",
      state: "done",
      output: { ...ep, beats: voiced },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 5: filming (P3)

function seedanceModel(cfg: DramaConfig): string {
  return SEEDANCE_MODELS[cfg.videoModel ?? ""] ?? SEEDANCE_MODELS["Seedance 2.0 Fast"];
}

function seedanceRate(model: string, resolution: string): number {
  const rates = SEEDANCE_PER_SEC[model] ?? SEEDANCE_PER_SEC[SEEDANCE_MODELS["Seedance 2.0 Fast"]];
  return rates[resolution] ?? rates["720p"];
}

/** A dialogue line rides along as reference audio only if Seedance will accept it. */
function usesVoiceReference(b: DramaBeat): boolean {
  return (
    b.kind === "dialogue" &&
    Boolean(b.audio_url) &&
    (b.audio_sec ?? 0) > 0 &&
    (b.audio_sec ?? 0) <= MAX_REFERENCE_AUDIO_SEC
  );
}

/**
 * Seedance's reference syntax is @Image1..@Image9 and @Audio1..@Audio3, in
 * the order the arrays are sent. Image 1 is always the storyboard frame, so
 * it anchors composition; each on-screen character's sheet follows.
 */
function seedancePrompt(b: DramaBeat, onScreen: DramaCharacter[], speaker: DramaCharacter | undefined, body: string): string {
  const parts = ["@Image1 is the opening frame: keep its composition, staging and lighting."];
  onScreen.forEach((c, i) => parts.push(`${c.name} looks exactly like @Image${i + 2}.`));
  parts.push(body);
  if (b.camera) parts.push(`Camera: ${b.camera}.`);
  if (b.kind === "dialogue" && speaker) {
    parts.push(
      usesVoiceReference(b)
        ? `${speaker.name} speaks the line in @Audio1, in that voice, lip-synced word for word: "${b.line}". Only ${speaker.name} speaks.`
        : `${speaker.name} says${b.emotion ? `, ${b.emotion}` : ""}: "${b.line}". Only ${speaker.name} speaks.`,
    );
  } else if (b.kind === "narration") {
    // Narration is laid over the finished clip in the cut, so nobody on
    // screen should appear to be saying it.
    parts.push("Nobody on screen speaks; mouths stay closed. Natural ambient sound only.");
  } else {
    parts.push("No dialogue. Natural ambient sound and foley only.");
  }
  parts.push("No background music, no subtitles, no on-screen text.");
  return parts.join(" ");
}

/** Marks filming as started and returns the beats that still need a clip. */
export const beginFilming = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<number[]> => {
    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const ep = episodeFrom(job, "voices");
    // A clip filmed on an earlier attempt of this same job survives it.
    const existing = job.steps.find((s) => s.id === "scenes")?.output as DramaEpisode | undefined;
    const filmed = new Map((existing?.beats ?? []).map((b) => [b.n, b.clip_url]));
    const beats = ep.beats.map((b) => ({ ...b, clip_url: filmed.get(b.n) ?? b.clip_url }));
    const todo = beats.filter((b) => !b.clip_url);

    const model = seedanceModel(cfg);
    const seconds = todo.reduce((sum, b) => sum + b.seconds, 0);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: seconds * seedanceRate(model, cfg.resolution ?? "720p"),
    });

    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scenes",
      state: "running",
      output: { ...ep, beats },
    });
    return todo.map((b) => b.n);
  },
});

export const submitBeatClip = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    beat: v.number(),
    variant: v.union(v.literal("original"), v.literal("reworded"), v.literal("minimal")),
  },
  handler: async (
    ctx,
    { jobId, beat, variant },
  ): Promise<{ statusUrl: string; responseUrl: string; model: string }> => {
    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const ep = episodeFrom(job, "scenes");
    const b = ep.beats.find((x) => x.n === beat);
    if (!b?.frame_url) throw new Error(`beat ${beat} has no storyboard frame to film from`);

    const chars = charById(ep);
    const onScreen = b.characters
      .map((id) => chars.get(id))
      .filter((c): c is DramaCharacter => Boolean(c?.image_url))
      .slice(0, 8);
    const speaker = chars.get(b.speaker);

    const motion = b.motion_prompt || b.action;
    let prompt = seedancePrompt(b, onScreen, speaker, motion);
    if (variant === "reworded") {
      prompt = await rewritePromptNeutrally(prompt, { model: DRAMA_LLM });
    } else if (variant === "minimal") {
      prompt = seedancePrompt(b, onScreen, speaker, "Subtle, natural movement that fits the moment.");
    }

    const model = seedanceModel(cfg);
    const handle = await submitQueued(model, {
      prompt,
      image_urls: [b.frame_url, ...onScreen.map((c) => c.image_url!)],
      ...(usesVoiceReference(b) ? { audio_urls: [b.audio_url] } : {}),
      duration: String(b.seconds),
      resolution: cfg.resolution ?? "720p",
      aspect_ratio: ep.aspectRatio,
      // Seedance's own audio is the dialogue, lip-synced, plus the room it's
      // spoken in -- and fal charges the same with or without it.
      generate_audio: true,
    });
    return { statusUrl: handle.statusUrl, responseUrl: handle.responseUrl, model };
  },
});

/** Leaves headroom under the 10-minute action ceiling for the result fetch. */
const POLL_BUDGET_MS = 5 * 60_000;

export const pollBeatClip = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    beat: v.number(),
    statusUrl: v.string(),
    responseUrl: v.string(),
    model: v.string(),
  },
  handler: async (
    ctx,
    { jobId, clientId, beat, statusUrl, responseUrl, model },
  ): Promise<"done" | "pending" | "policy"> => {
    const polled = await pollQueued(model, { statusUrl, responseUrl }, {
      budgetMs: POLL_BUDGET_MS,
      pollMs: 5_000,
    });
    if (polled.state !== "done") return polled.state;

    const url = (polled.result as { video?: { url?: string } }).video?.url;
    if (!url) throw new Error(`Seedance returned no video for beat ${beat}`);

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const seconds = episodeFrom(job, "scenes").beats.find((b) => b.n === beat)?.seconds ?? 5;

    // Recorded once even if this action is retried after the write: the
    // mutation reports whether the clip was new.
    const fresh = await ctx.runMutation(internal.drama.recordBeatClip, { jobId, beat, clipUrl: url });
    if (fresh) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "scenes",
        primitive: "P3",
        model,
        units: seconds,
        unitLabel: "seconds",
        costUsd: seconds * seedanceRate(model, cfg.resolution ?? "720p"),
      });
    }
    return "done";
  },
});

/**
 * Beats finish in any order and in parallel, so each writes only its own
 * clip into the scenes output -- a read-modify-write that Convex's
 * transactions keep from clobbering a neighbour's.
 */
export const recordBeatClip = internalMutation({
  args: { jobId: v.id("jobs"), beat: v.number(), clipUrl: v.string() },
  handler: async (ctx, { jobId, beat, clipUrl }): Promise<boolean> => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("unknown job");
    let fresh = false;
    const steps = job.steps.map((s) => {
      if (s.id !== "scenes") return s;
      const out = s.output as DramaEpisode;
      const beats = out.beats.map((b) => {
        if (b.n !== beat || b.clip_url) return b;
        fresh = true;
        return { ...b, clip_url: clipUrl };
      });
      return { ...s, output: { ...out, beats } };
    });
    if (fresh) await ctx.db.patch(jobId, { steps });
    return fresh;
  },
});

// ---------------------------------------------------------------- stage 6: score (P4)

const MOOD_BRIEF: Record<string, string> = {
  Tense: "tense, suspenseful underscore with a pulsing low end",
  Romantic: "romantic, aching strings and soft piano",
  Melancholy: "melancholy, sparse piano and cello",
  Uplifting: "uplifting, warm and building, hopeful",
};

export const scoreMusic = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "music", state: "running" });

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const ep = episodeFrom(job, "scenes");
    const totalSec = ep.beats.reduce((sum, b) => sum + b.seconds, 0);
    const minutes = Math.max(1, Math.ceil(totalSec / 60));
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: minutes * MUSIC_PER_MINUTE,
    });

    const mood = MOOD_BRIEF[cfg.music ?? ""] ?? "";
    const prompt =
      `Instrumental score for a short drama episode, "${ep.title}". ` +
      `${[mood, ep.score].filter(Boolean).join(". ")}. ` +
      "Cinematic underscore that sits beneath dialogue -- no vocals, no lyrics.";

    const result = (await submitAndPoll(MUSIC_MODEL, {
      prompt,
      music_length_ms: Math.min(600_000, Math.max(3_000, Math.round(totalSec * 1000))),
      force_instrumental: true,
    })) as { audio?: { url?: string } };
    const url = result.audio?.url;
    if (!url) throw new Error("no music returned");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "music",
      primitive: "P4",
      model: MUSIC_MODEL,
      units: minutes,
      unitLabel: "minutes",
      costUsd: minutes * MUSIC_PER_MINUTE,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "music",
      state: "done",
      output: { musicUrl: url },
    });
    return null;
  },
});

// ---------------------------------------------------------------- stage 7: final cut (P7)

export const finalCut = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "cut", state: "running" });

    const job = await loadJob(ctx, jobId);
    const cfg = config(job);
    const ep = episodeFrom(job, "scenes");
    const missing = ep.beats.filter((b) => !b.clip_url).map((b) => b.n);
    if (missing.length) throw new Error(`beats ${missing.join(", ")} were never filmed`);
    const musicUrl = (job.steps.find((s) => s.id === "music")?.output as { musicUrl?: string } | undefined)
      ?.musicUrl;
    const subtitles = cfg.captionOverlay !== false;

    // Same direct-to-storage upload as Video Animation's stitch: a finished
    // episode is far past Convex's 16MB argument ceiling as base64.
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${renderServiceBase()}/render/drama`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        beats: ep.beats.map((b) => ({
          videoUrl: b.clip_url,
          // Dialogue is already inside the clip, spoken by Seedance; only
          // narration is laid over it here.
          voiceoverUrl: b.kind === "narration" ? (b.audio_url ?? null) : null,
          caption: subtitles && b.line ? b.line : null,
          durationSec: b.seconds,
        })),
        dimensions: ep.aspectRatio,
        captionStyle: cfg.captionStyle ?? "Classic",
        musicUrl: musicUrl ?? null,
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
      stepId: "cut",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "cut",
      state: "done",
      output: { files: [{ name: "episode.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.drama.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
