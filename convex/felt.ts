import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./carousel";

/**
 * Felt: narration -> speech -> the product composited into a stop-motion
 * felt-craft scene -> animated -> narrated and captioned.
 *
 * Byte-identical to Claymation and Skeleton apart from this one art-direction
 * string, per `clayLikePipeline(artDirection)` in `planned.ts`. Uses
 * `bluntStyleConfig` rather than `clayLikeConfig` for its "Style" options, but
 * that only changes the choice list -- the field name is still "style", so
 * every shared primitive below reads it exactly the same way.
 */
const FELT_STYLE =
  "Stop-motion felt-craft style: everything built from cut and stitched " +
  "felt fabric, visible running stitches and fuzzy fibrous texture, soft " +
  "rounded shapes, warm handmade-diorama lighting, miniature tabletop set.";

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
        { ...args, artDirection: FELT_STYLE },
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
    const id = await workflow.start(ctx, internal.felt.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
