import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./carousel";

/**
 * Talking Objects: narration -> speech -> the product composited as an
 * anthropomorphized, talking version of itself -> animated -> narrated and
 * captioned.
 *
 * Byte-identical to Claymation and Skeleton apart from this one art-direction
 * string, per `clayLikePipeline(artDirection)` in `planned.ts`. Uses
 * `bluntStyleConfig` rather than `clayLikeConfig` for its "Style" options, but
 * that only changes the choice list -- the field name is still "style", so
 * every shared primitive below reads it exactly the same way.
 */
const TALKING_OBJECT_STYLE =
  "The product itself is brought to life as a talking character: a small " +
  "expressive cartoon face -- eyes and an open mouth mid-speech -- added " +
  "directly onto the object's own surface, no separate body or limbs, " +
  "object staying otherwise photoreal, product-shot studio lighting on a " +
  "plain seamless background, straight-to-camera framing.";

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
        { ...args, artDirection: TALKING_OBJECT_STYLE },
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
    const id = await workflow.start(ctx, internal.talkingObjects.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
