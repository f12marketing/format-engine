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

    // Phase 0 ships one runnable format. Adding the second is a line here plus
    // its workflow -- not a new route, and not a branch in the frontend.
    if (args.formatId !== "carousel") {
      throw new Error(
        `${args.formatId} has no pipeline yet. Only Carousel runs in Phase 0.`,
      );
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

    // carousel.start records the workflowId on the job itself, so there is a
    // single writer for that field.
    await ctx.runMutation(internal.carousel.start, {
      jobId,
      clientId: client._id,
    });

    return jobId;
  },
});
