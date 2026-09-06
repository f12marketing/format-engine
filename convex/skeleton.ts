import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./carousel";

/**
 * Skeleton: narration -> speech -> the product composited into an anatomical
 * skeleton scene -> animated -> narrated and captioned.
 *
 * Byte-identical to Claymation except `SKELETON_STYLE` -- see that file's
 * comment for why this is a full second file rather than a parameter to it.
 */
const SKELETON_STYLE =
  "Educational anatomy-illustration style: a clean articulated human " +
  "skeleton model, bone-white with visible joints and sutures, neutral " +
  "clinical or classroom background, even diffuse lighting, no soft tissue.";

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
        { ...args, artDirection: SKELETON_STYLE },
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
    const id = await workflow.start(ctx, internal.skeleton.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
