import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./carousel";

/**
 * Lego: narration -> speech -> the product composited into a stop-motion
 * Lego-brick scene -> animated -> narrated and captioned.
 *
 * Byte-identical to Claymation and Skeleton apart from this one art-direction
 * string, per `clayLikePipeline(artDirection)` in `planned.ts`.
 */
const LEGO_STYLE =
  "Stop-motion Lego brick style: everything built from interlocking plastic " +
  "bricks and minifigure parts, visible stud bumps and seams, glossy " +
  "injection-molded plastic sheen, bright saturated primary colors, " +
  "miniature tabletop set with soft studio lighting.";

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
        { ...args, artDirection: LEGO_STYLE },
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
    const id = await workflow.start(ctx, internal.lego.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
