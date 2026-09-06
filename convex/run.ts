import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

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

    // One line per runnable format, plus its workflow. Not a new route, and
    // not a branch anywhere in the frontend.
    const STARTERS = {
      carousel: internal.carousel.start,
      custom: internal.custom.start,
      "wall-of-text": internal.wallOfText.start,
      slideshow: internal.slideshow.start,
    } as const;

    const starter = STARTERS[args.formatId as keyof typeof STARTERS];
    if (!starter) {
      throw new Error(`${args.formatId} has no pipeline yet.`);
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
