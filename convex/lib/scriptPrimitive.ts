import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { LLM_MODEL } from "./fal";
import { wordBudget, writeWithinBudget } from "./wordBudget";
import { GROUNDING_RULES } from "./grounding";
import { businessContext } from "./businessContext";

/** Conversational delivery runs a little faster than narration. */
const SCRIPT_WORDS_PER_SEC = 2.5;

/**
 * P1, shared by the four avatar formats whose script-writing step is
 * identical in everything but which config field the caller reads the
 * prompt from. Speaking Hook & Demo is NOT one of the four -- its own P1
 * writes a punchy hook line from a fixed "hook" field with a different
 * budget and voice, closer to Wall of Text than a script.
 */
const SCRIPT_SYSTEM = `You write a short spoken-word video script for a single person talking
directly to camera.

- Written to be SPOKEN, not read: short sentences, no bullet points, no
  markdown, no stage directions or parentheticals.
- Open with a hook in the first sentence -- the viewer decides whether to
  keep watching in the first two seconds.
- Conversational, first person, plain words. Never sound like an ad voiceover:
  no "game-changer", "you won't believe", "here's the thing", "trust me on
  this one" -- a real person talking to a friend doesn't reach for those.
- Stay within the word limit given with the brief -- it is what fits the
  video's length at a natural speaking pace. A short video gets one sharp
  line, not a compressed paragraph.
- If told to mention a business, weave its name in naturally -- don't append it.

${GROUNDING_RULES}`;

const SCRIPT_TOOL = {
  name: "save_script",
  description: "Save the generated script.",
  input_schema: {
    type: "object",
    properties: {
      script: { type: "string" },
    },
    required: ["script"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

export const writeScript = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as {
      prompt?: string;
      mentionBusiness?: boolean;
      duration?: number;
    };

    const brief = (config.prompt ?? "").trim();
    if (!brief) throw new Error("Give a prompt to generate the script from.");

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.03 });

    const duration = config.duration ?? 30;
    const maxWords = wordBudget(duration, SCRIPT_WORDS_PER_SEC);
    const userPrompt =
      `${brief}\n\nTarget spoken length: ${duration} seconds -- at most ${maxWords} words.` +
      (await businessContext(ctx, clientId, config.mentionBusiness));

    const call = await writeWithinBudget(SCRIPT_SYSTEM, userPrompt, SCRIPT_TOOL, "script", maxWords);
    const script = call.text;
    if (!script) throw new Error("model returned no script");

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
    // Generic key ("text", not "script") so the shared speech primitive can
    // read every format's copy step output the same way regardless of what
    // its own config field happens to be called (script, saying, ...).
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { text: script },
    });
    return null;
  },
});
