import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./carousel";

/**
 * Claymation: narration -> speech -> the product composited into a clay
 * stop-motion scene -> animated -> narrated and captioned.
 *
 * Every stage is a shared primitive -- Skeleton is the same file with one
 * string swapped, which is exactly why `clayLikePipeline(artDirection)` in
 * `planned.ts` exists. `CLAY_STYLE` here is that string; nothing server-side
 * reads it from the Step's declared `options`, it's just passed directly.
 */
const CLAY_STYLE =
  "Stop-motion claymation style: visible fingerprints and tool marks in the " +
  "clay, matte plasticine texture, slightly imperfect hand-sculpted forms, " +
  "soft studio lighting with a subtle grain, miniature tabletop set.";

export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.lib.narrationPrimitive.writeNarration, args, {
          retry: true,
        });
      }
      await step.runAction(
        internal.lib.speechPrimitive.generateSpeech,
        { ...args, textConfigField: "narration" },
        { retry: true },
      );
      await step.runAction(
        internal.lib.clayScenePrimitive.composeClayScene,
        { ...args, artDirection: CLAY_STYLE },
        { retry: true },
      );
      await step.runAction(internal.lib.animateScenePrimitive.animateScene, args, { retry: true });
      await step.runAction(internal.lib.narratedClipPrimitive.renderNarratedClip, args, {
        retry: true,
      });
      await step.runMutation(internal.jobs.finish, { jobId: args.jobId, status: "done" });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.claymation.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
