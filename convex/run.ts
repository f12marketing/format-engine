import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { STARTERS, type RunnableFormatId } from "./starters";
import { enforceRateLimit } from "./lib/rateLimit";
import { assertLikenessConsent, uploadedPhotoRefs } from "./lib/likeness";
import { assertClipRights, clipIdsIn } from "./clips";

/**
 * The Generate button's single entry point, for every format.
 *
 * The frontend hands over a formatId, the config values and the pipeline the
 * registry declared. It deliberately does not decide what runs -- it cannot,
 * because the workflow is server-side -- so this is the boundary where a job
 * row and a durable workflow come into existence together.
 */
export const generate = mutation({
  args: {
    formatId: v.string(),
    config: v.any(),
    steps: v.array(
      v.object({ id: v.string(), primitive: v.string(), label: v.string() }),
    ),
    remixedFromJobId: v.optional(v.id("jobs")),
  },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const client = await requireClient(ctx);
    await enforceRateLimit(ctx, "generateJob", client._id);

    const starter = STARTERS[args.formatId as RunnableFormatId];
    if (!starter) {
      throw new Error(`${args.formatId} has no pipeline yet.`);
    }

    // A real person is only animated with their permission (lib/likeness.ts):
    // a photo picked from My images carries it on the asset, and Character
    // Swap -- which transforms whoever is in the uploaded clip -- asks per job.
    await assertLikenessConsent(ctx, client._id, uploadedPhotoRefs(args.config));
    // Someone else's video is only reused in an ad with their permission.
    await assertClipRights(ctx, client._id, clipIdsIn(args.config));
    if (args.formatId === "character-swap" && args.config?.likenessConsent !== true) {
      throw new Error("Confirm you have permission from the people in your video and image.");
    }

    const jobId = await ctx.db.insert("jobs", {
      clientId: client._id,
      formatId: args.formatId,
      // A frozen copy, never a reference: re-running this in six weeks must
      // not pick up an edited brand or a changed default.
      config: args.config,
      status: "running",
      steps: args.steps.map((s) => ({ ...s, state: "pending" as const })),
      costUsd: 0,
      remixedFromJobId: args.remixedFromJobId,
    });

    // The starter records the workflowId on the job itself, so there is a
    // single writer for that field.
    await ctx.runMutation(starter, { jobId, clientId: client._id });

    return jobId;
  },
});
