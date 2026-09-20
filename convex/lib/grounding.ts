import { callTool, LLM_MODEL } from "./fal";

/**
 * World logic: making the video's details true to the real world.
 *
 * The first Claymation test asked for "a person building a house in
 * Antarctica" and got a man in a t-shirt and chinos nailing together a
 * timber-framed cabin. Nothing in the pipeline was wrong, exactly -- the
 * prompt was passed to an image model, which drew the most generic reading of
 * each noun. Nothing ever asked what building a house in Antarctica would
 * actually involve: an insulated parka and goggles, an igloo of cut snow
 * blocks or a prefab station on stilts, no trees for a hundred miles.
 *
 * Image models are bad at this and language models are good at it, so the
 * reasoning happens in text, before any pixel is generated. Two exports:
 *
 *  - GROUNDING_RULES, appended to the system prompt of every step that
 *    already has a language model in it (narration, scripts, shot plans,
 *    story writing). Free -- it is just more system prompt.
 *  - groundScene(), one small call that turns a topic into a concrete brief,
 *    for the formats whose scene is built from the topic alone and which had
 *    no reasoning step at all.
 */

/**
 * Appended to a system prompt. Written as questions the model has to answer
 * rather than a flat "be realistic", which models reliably ignore.
 */
export const GROUNDING_RULES = `GROUND EVERY DETAIL IN THE REAL WORLD.

Before writing, work out what the subject actually involves, and let that
decide the details. Ask yourself:

- Place and climate: where on Earth is this, and what is it like there? What
  do people wear to survive that temperature and weather? Antarctica means
  insulated parkas, goggles and gloves, never bare skin or casual clothes.
- Materials and building: what is actually available there, and what do
  people really build with? There are no trees in Antarctica, so a shelter is
  cut snow blocks, ice, or a prefabricated hut flown in -- not a timber frame.
  Adobe in a desert, bamboo in the tropics, stone where there is stone.
- Wildlife and plants: only what genuinely lives there. Penguins are
  Antarctic; polar bears are Arctic. Never put them together.
- Tools and method: what equipment does this job really use, and how is it
  actually done, step by step and in the right order?
- Safety and practice: what would a competent person wear and do -- gloves,
  goggles, a harness, a helmet -- and what would they never do?
- Period and technology: if a time or era is implied, only what existed then.
- Scale and physics: sizes, weights and forces that make sense, and effects
  that follow their causes.

If the brief names something that would not really work that way, keep what
the person asked for and make everything around it correct and convincing.
Specific, true details are what make a short video believable; a generic or
impossible detail is what makes it look fake.`;

/** A concrete, physically grounded description of the scene to draw. */
export interface SceneBrief {
  /** The real place, concretely: terrain, structures, weather, time of day. */
  setting: string;
  /** The focal point and what it is doing, in real terms. */
  subject: string;
  /** What the subject wears, right for that climate and that job. */
  wardrobe: string;
  /** What things are made of, and what they are really built from. */
  materials: string;
  /** Tools and objects that genuinely belong in this scene. */
  props: string;
  /** Light consistent with the place, weather and hour. */
  lighting: string;
  /** The plausible-but-wrong details this scene must NOT contain. */
  avoid: string;
}

const BRIEF_SYSTEM = `You are an art director briefing an image generator for a short video.

You are given a topic. Turn it into a concrete, factually correct description
of ONE still frame. Be specific and visual -- name real materials, garments,
tools and terrain rather than categories. Every field is read literally by an
image model, so write what should be SEEN, not what it means.

KEEP IT SHORT. One sentence per field, at most about 25 words. These are
prompt fragments, not paragraphs: a long field buries the detail that matters.

Describe only the real-world facts -- what is there, what it is made of, what
is worn. Say NOTHING about rendering style, medium, texture or finish. The
frame is rendered in a style that is applied separately, and repeating it here
fights that.

${GROUNDING_RULES}

The "avoid" field is where you name the mistakes an image model would make on
this exact topic if left alone -- the generic, plausible-looking details that
would actually be wrong here. Be concrete and specific to this topic, and keep
it to a short comma-separated list. For "building a house in Antarctica" that
is: no timber-framed house, no exposed skin, no casual clothing, no grass or
trees, no polar bears.`;

const BRIEF_TOOL = {
  name: "save_scene_brief",
  description: "Save the grounded description of the scene.",
  input_schema: {
    type: "object",
    properties: {
      setting: { type: "string" },
      subject: { type: "string" },
      wardrobe: { type: "string" },
      materials: { type: "string" },
      props: { type: "string" },
      lighting: { type: "string" },
      avoid: { type: "string" },
    },
    required: ["setting", "subject", "wardrobe", "materials", "props", "lighting", "avoid"],
  },
};

export const GROUNDING_INPUT_PER_1M = 2.0;
export const GROUNDING_OUTPUT_PER_1M = 10.0;

export interface GroundSceneResult {
  brief: SceneBrief;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

/**
 * One LLM pass turning a topic into a grounded scene brief.
 *
 * `hasSubjectImage` tells it that a real photo is being composited in, so it
 * describes the world around that subject rather than inventing one.
 */
export async function groundScene(
  topic: string,
  opts: { style?: string; artDirection?: string; hasSubjectImage?: boolean } = {},
): Promise<GroundSceneResult> {
  const userPrompt = [
    `Topic: ${topic}`,
    opts.style && `Tone: ${opts.style}`,
    // Given so the brief suits the medium, with an explicit reminder not to
    // describe it -- the art direction is prepended to the image prompt
    // separately, and a brief that repeats it crowds out the real detail.
    opts.artDirection &&
      `For context only, the frame is rendered as: ${opts.artDirection} ` +
        "Do not mention this style, its texture or its medium in any field.",
    opts.hasSubjectImage
      ? "A real photograph of the subject will be composited into this frame, so describe " +
        "the world around it -- the setting, what else is there, the light. In 'wardrobe', " +
        "say what the subject should be WEARING OR FITTED WITH to belong in that place, " +
        "only if that can be added around it without altering the subject itself."
      : "The whole frame is generated from your description.",
  ]
    .filter(Boolean)
    .join("\n");

  const call = await callTool(BRIEF_SYSTEM, userPrompt, BRIEF_TOOL);
  const v = (call.value ?? {}) as Partial<SceneBrief>;
  const text = (s: unknown) => (typeof s === "string" ? s.trim() : "");
  return {
    brief: {
      setting: text(v.setting),
      subject: text(v.subject),
      wardrobe: text(v.wardrobe),
      materials: text(v.materials),
      props: text(v.props),
      lighting: text(v.lighting),
      avoid: text(v.avoid),
    },
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd:
      (call.inputTokens / 1e6) * GROUNDING_INPUT_PER_1M +
      (call.outputTokens / 1e6) * GROUNDING_OUTPUT_PER_1M,
    model: LLM_MODEL,
  };
}

/** The brief as image-prompt text, in the order an image model reads best. */
export function briefToPrompt(brief: SceneBrief): string {
  return [
    brief.subject && `${brief.subject}`,
    brief.wardrobe && `Wearing: ${brief.wardrobe}.`,
    brief.setting && `Setting: ${brief.setting}.`,
    brief.materials && `Materials: ${brief.materials}.`,
    brief.props && `In shot: ${brief.props}.`,
    brief.lighting && `Light: ${brief.lighting}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
