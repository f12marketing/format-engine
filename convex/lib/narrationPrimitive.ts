import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callTool, LLM_MODEL } from "./fal";

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
- Plain, concrete words. Length should read aloud in roughly the target
  duration at a natural narration pace (~2.3 words/second, slightly slower
  than conversational speech).`;

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

const LLM_INPUT_PER_1M = 3.0;
const LLM_OUTPUT_PER_1M = 15.0;

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
    const userPrompt =
      `${brief}\n\nTarget spoken length: about ${duration} seconds.` +
      (config.style ? `\nTone/style: ${config.style}.` : "");

    const call = await callTool(NARRATION_SYSTEM, userPrompt, NARRATION_TOOL as never);
    const narration = String((call.value as { narration?: string })?.narration ?? "").trim();
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
