import { v } from "convex/values";
import { sendEvent } from "@convex-dev/workflow";
import type { WorkflowId } from "@convex-dev/workflow";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
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

/**
 * Approval gates, for Video Animation's three review points (and Product
 * Spokesperson's one, later). A gated step finishes its work, calls this to
 * park itself, then the workflow calls `step.awaitEvent` -- which is what
 * actually suspends it, consuming no resources while it waits. This mutation
 * only records that the job is now sitting at a gate, so the UI has
 * something to render.
 */
export const setAwaitingApproval = internalMutation({
  args: { jobId: v.id("jobs"), stepId: v.string(), output: v.any() },
  handler: async (ctx, { jobId, stepId, output }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("unknown job");
    const steps = job.steps.map((s) =>
      s.id === stepId ? { ...s, state: "awaiting_approval" as const, output } : s,
    );
    await ctx.db.patch(jobId, { steps, status: "awaiting_approval" });
  },
});

/** Flips the job back to "running" once a gate's event has been sent. */
export const setRunning = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ctx.db.patch(jobId, { status: "running" });
  },
});

/**
 * The Approve button's mutation. `edits`, when given, replaces the gated
 * step's output before sending the event -- so approving a story you tweaked
 * a line of is one action, not "save" then "approve".
 *
 * Scoped by client, not by job id: an id is not an authorisation, and a
 * workflow only resumes for an event sent with ITS OWN workflowId, so there
 * is no risk of approving a step on someone else's run even with the same
 * stepId string.
 */
export const approveStep = mutation({
  args: { jobId: v.id("jobs"), stepId: v.string(), edits: v.optional(v.any()) },
  handler: async (ctx, { jobId, stepId, edits }) => {
    const client = await requireClient(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.clientId !== client._id) throw new Error("job not found");
    if (!job.workflowId) throw new Error("job has no running workflow");

    const step = job.steps.find((s) => s.id === stepId);
    if (!step || step.state !== "awaiting_approval") {
      throw new Error(`step "${stepId}" is not awaiting approval`);
    }

    if (edits !== undefined) {
      const steps = job.steps.map((s) => (s.id === stepId ? { ...s, output: edits } : s));
      await ctx.db.patch(jobId, { steps });
    }

    await sendEvent(ctx, components.workflow, {
      name: `approve:${jobId}:${stepId}`,
      // The schema stores this as a plain string (jobs.workflowId is set from
      // every format's own `start` mutation, none of which import this
      // component-specific branded type) -- safe to assert here since it was
      // produced by this same workflow component's own `start()` call.
      workflowId: job.workflowId as WorkflowId,
    });
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
    /**
     * Only patch what was actually supplied.
     *
     * Convex treats `patch({ field: undefined })` as "delete this field", so
     * passing the whole destructured object wiped outputAssetIds and error on
     * every successful finish -- the render step had just set them, and this
     * removed them a moment later. The assets survived; the job's pointer to
     * them did not.
     */
    const patch: Record<string, unknown> = { status };
    if (outputAssetIds !== undefined) patch.outputAssetIds = outputAssetIds;
    if (error !== undefined) patch.error = error;
    await ctx.db.patch(jobId, patch);
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
