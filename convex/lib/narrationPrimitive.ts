import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { LLM_MODEL } from "./fal";
import { wordBudget, writeWithinBudget } from "./wordBudget";

/** Measured on the ElevenLabs narration voice: 2.3-2.5 words/second. */
const NARRATION_WORDS_PER_SEC = 2.3;

/**
 * P1, shared by Cutting Fruit, Claymation and Skeleton -- voiceover narration
 * read OVER a generated scene, not a script for someone talking to camera.
 * That distinction is why this isn't `scriptPrimitive.ts` with a flag: the
 * two read completely differently out loud (third-person/descriptive here vs.
 * first-person direct address there), and `scriptPrimitive`'s own comment
 * already reserves it for formats where a person addresses the viewer.
 */
const NARRATION_SYSTEM = `You write a short voiceover narration track for a video where the visuals are
generated separately -- the viewer sees a scene, not a person talking to camera.

- Written to be SPOKEN by a narrator over the footage: no stage directions,
  no markdown, no camera or shot descriptions -- those are handled elsewhere.
- Descriptive/third-person register, not direct address ("she slices through
  the mango" reads naturally here; "I'm going to show you" does not).
- Open with a hook in the first sentence -- the viewer decides whether to
  keep watching in the first two seconds.
- Plain, concrete words. Stay within the word limit given with the brief --
  it is what fits the video's length when read aloud. A short video gets
  one sharp line, not a compressed paragraph.
- Avoid stock ad-voiceover filler: "in today's world", "imagine a world
  where", "picture this", "let's dive in", "game-changer", "at the end of
  the day". If a line could open any video about anything, it's not
  specific enough to this one.`;

const NARRATION_TOOL = {
  name: "save_narration",
  description: "Save the generated narration.",
  input_schema: {
    type: "object",
    properties: {
      narration: { type: "string" },
    },
    required: ["narration"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

export const writeNarration = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { prompt?: string; style?: string; duration?: number };

    const brief = (config.prompt ?? "").trim();
    if (!brief) {
      throw new Error("Write the narration yourself, or give a prompt to generate it from.");
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.03 });

    const duration = config.duration ?? 30;
    const maxWords = wordBudget(duration, NARRATION_WORDS_PER_SEC);
    const userPrompt =
      `${brief}\n\nTarget spoken length: ${duration} seconds -- at most ${maxWords} words.` +
      (config.style ? `\nTone/style: ${config.style}.` : "");

    const call = await writeWithinBudget(
      NARRATION_SYSTEM,
      userPrompt,
      NARRATION_TOOL,
      "narration",
      maxWords,
    );
    const narration = call.text;
    if (!narration) throw new Error("model returned no narration");

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
    // Generic key ("text"), matching scriptPrimitive -- speechPrimitive reads
    // every format's copy step the same way regardless of the wording task.
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { text: narration },
    });
    return null;
  },
});
