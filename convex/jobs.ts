import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

/**
 * One row per run, for every format. The frontend subscribes to these rather
 * than polling: the preview panel moves from empty to per-step progress to
 * result because the workflow writes its progress here as it goes.
 */

const stepValidator = v.object({
  id: v.string(),
  primitive: v.string(),
  label: v.string(),
  state: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("awaiting_approval"),
    v.literal("done"),
    v.literal("failed"),
    v.literal("skipped"),
  ),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  output: v.optional(v.any()),
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const client = await requireClient(ctx);
    return ctx.db
      .query("jobs")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(limit ?? 25);
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const client = await requireClient(ctx);
    const job = await ctx.db.get(jobId);
    // Scoped by client, not just by id -- an id is not an authorisation.
    if (!job || job.clientId !== client._id) return null;
    return job;
  },
});

/**
 * Creates the job row and seeds its step list from the format's declared
 * pipeline. The config is a frozen copy: re-running this job in six weeks must
 * not pick up an edited brand or a changed default.
 */
export const create = mutation({
  args: {
    formatId: v.string(),
    config: v.any(),
    steps: v.array(stepValidator),
    remixedFromJobId: v.optional(v.id("jobs")),
  },
  handler: async (ctx, args): Promise<Id<"jobs">> => {
    const client = await requireClient(ctx);
    return ctx.db.insert("jobs", {
      clientId: client._id,
      formatId: args.formatId,
      config: args.config,
      status: "running",
      steps: args.steps,
      costUsd: 0,
      remixedFromJobId: args.remixedFromJobId,
    });
  },
});

export const patchStep = internalMutation({
  args: {
    jobId: v.id("jobs"),
    stepId: v.string(),
    state: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("awaiting_approval"),
        v.literal("done"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, stepId, state, output, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("unknown job");

    const now = Date.now();
    const steps = job.steps.map((s) => {
      if (s.id !== stepId) return s;
      return {
        ...s,
        state: state ?? s.state,
        output: output ?? s.output,
        error: error ?? s.error,
        startedAt: state === "running" ? now : s.startedAt,
        endedAt:
          state === "done" || state === "failed" || state === "skipped"
            ? now
            : s.endedAt,
      };
    });
    await ctx.db.patch(jobId, { steps });
  },
});

export const finish = internalMutation({
  args: {
    jobId: v.id("jobs"),
    status: v.union(v.literal("done"), v.literal("failed")),
    outputAssetIds: v.optional(v.array(v.id("assets"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, status, outputAssetIds, error }) => {
    await ctx.db.patch(jobId, { status, outputAssetIds, error });
  },
});

/** Read a job from inside a workflow step, where auth context isn't available. */
export const getInternal = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

/** The step ids this job actually plans to run. Read from inside the workflow. */
export const plannedStepIds = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }): Promise<string[]> => {
    const job = await ctx.db.get(jobId);
    return job ? job.steps.map((s) => s.id) : [];
  },
});

/** Points the job at what it produced, so the outputs survive independently. */
export const setOutputs = internalMutation({
  args: { jobId: v.id("jobs"), assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { jobId, assetIds }) => {
    await ctx.db.patch(jobId, { outputAssetIds: assetIds });
  },
});
