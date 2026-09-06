import { v } from "convex/values";
import { sendEvent } from "@convex-dev/workflow";
import { components } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Dev-only helpers, callable from the CLI with `npx convex run`.
 *
 * These are `internal*` on purpose: they are unreachable from the browser and
 * from any client SDK, so they cannot become a back door around the
 * invite-only check in clients.ts. They exist so the pipeline can be exercised
 * end to end before Clerk is configured, which is otherwise a chicken and egg.
 */

export const seedClient = internalMutation({
  args: { displayName: v.string(), capUsd: v.optional(v.number()) },
  handler: async (ctx, { displayName, capUsd }): Promise<Id<"clients">> => {
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", `dev:${displayName}`))
      .unique();
    if (existing) return existing._id;

    return ctx.db.insert("clients", {
      // Namespaced so a dev row can never collide with a real Supabase user id.
      authUserId: `dev:${displayName}`,
      displayName,
      monthlySpendCapUsd: capUsd ?? 50,
    });
  },
});

/**
 * Starts a carousel run for a client, bypassing the auth-scoped `run.generate`.
 * Everything after this point is the real path: the same workflow, the same
 * render service, the same ledger.
 */
export const startCarousel = internalMutation({
  args: {
    clientId: v.id("clients"),
    config: v.any(),
    /** Omit "copy" to supply your own deck and skip the paid LLM call. */
    stepIds: v.array(v.string()),
  },
  handler: async (ctx, { clientId, config, stepIds }): Promise<Id<"jobs">> => {
    const LABELS: Record<string, { primitive: string; label: string }> = {
      copy: { primitive: "P1", label: "Write the deck" },
      render: { primitive: "P8", label: "Render slides and PDF" },
    };

    const jobId = await ctx.db.insert("jobs", {
      clientId,
      formatId: "carousel",
      config,
      status: "running",
      steps: stepIds.map((id) => ({
        id,
        primitive: LABELS[id]?.primitive ?? "P?",
        label: LABELS[id]?.label ?? id,
        state: "pending" as const,
      })),
      costUsd: 0,
    });

    await ctx.runMutation(internal.carousel.start, { jobId, clientId });
    return jobId;
  },
});

/** The whole picture for one job: status, steps, and its ledger rows. */
export const inspect = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const ledger = await ctx.db
      .query("spend_ledger")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    return {
      status: job.status,
      costUsd: job.costUsd,
      error: job.error,
      steps: job.steps.map((s) => ({ id: s.id, state: s.state, error: s.error })),
      // The full output of whichever step is sitting at a gate, so a CLI run
      // can review it without a browser.
      gateOutput: job.steps.find((s) => s.state === "awaiting_approval")?.output ?? null,
      // Whichever step produced files -- "render" for carousel, "composite"
      // for custom. Hardcoding one step id made this lie for every format
      // whose last step happens to be named something else.
      renderedFiles: job.steps.flatMap(
        (s) =>
          (s.output as { files?: { name: string }[] } | undefined)?.files?.map(
            (f) => f.name,
          ) ?? [],
      ),
      assets: await Promise.all(
        (
          await ctx.db
            .query("assets")
            .withIndex("by_job", (q) => q.eq("producedByJobId", jobId))
            .collect()
        ).map(async (a) => ({
          kind: a.kind,
          mimeType: a.mimeType,
          bytes: a.bytes,
          url: await ctx.storage.getUrl(a.storageId),
        })),
      ),
      outputAssetCount: job.outputAssetIds?.length ?? 0,
      ledger: ledger.map((l) => ({
        stepId: l.stepId,
        primitive: l.primitive,
        model: l.model,
        units: l.units,
        unitLabel: l.unitLabel,
        costUsd: l.costUsd,
      })),
    };
  },
});

/**
 * Seeds an asset straight from base64, so the pipeline can be exercised before
 * the browser upload control exists. Dev-only, like everything else here.
 */
export const seedAsset = internalAction({
  args: {
    clientId: v.id("clients"),
    base64: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, { clientId, base64, mimeType }): Promise<Id<"assets">> => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const storageId = await ctx.storage.store(
      new Blob([bytes as unknown as BlobPart], { type: mimeType }),
    );
    return ctx.runMutation(internal.assets.record, {
      clientId,
      storageId,
      mimeType,
      bytes: bytes.byteLength,
    });
  },
});

/** Starts any registered format for a client, bypassing the auth-scoped path. */
export const startJob = internalMutation({
  args: {
    clientId: v.id("clients"),
    formatId: v.string(),
    config: v.any(),
    steps: v.array(v.object({ id: v.string(), primitive: v.string(), label: v.string() })),
  },
  handler: async (ctx, { clientId, formatId, config, steps }): Promise<Id<"jobs">> => {
    const jobId = await ctx.db.insert("jobs", {
      clientId,
      formatId,
      config,
      status: "running",
      steps: steps.map((s) => ({ ...s, state: "pending" as const })),
      costUsd: 0,
    });
    const starters: Record<string, typeof internal.carousel.start> = {
      carousel: internal.carousel.start,
      custom: internal.custom.start,
      "wall-of-text": internal.wallOfText.start,
      slideshow: internal.slideshow.start,
      "video-animation": internal.videoAnimation.start,
    };
    const starter = starters[formatId];
    if (!starter) throw new Error(`no pipeline for ${formatId}`);
    await ctx.runMutation(starter, { jobId, clientId });
    return jobId;
  },
});

/** Auth-free equivalent of jobs.approveStep, for exercising a gate from the CLI. */
export const approveStep = internalMutation({
  args: { jobId: v.id("jobs"), stepId: v.string(), edits: v.optional(v.any()) },
  handler: async (ctx, { jobId, stepId, edits }): Promise<null> => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("unknown job");
    const step = job.steps.find((s) => s.id === stepId);
    if (!step || step.state !== "awaiting_approval") {
      throw new Error(`step "${stepId}" is not awaiting approval`);
    }
    if (edits !== undefined) {
      const steps = job.steps.map((s) => (s.id === stepId ? { ...s, output: edits } : s));
      await ctx.db.patch(jobId, { steps });
    }
    if (!job.workflowId) throw new Error("job has no running workflow");
    await sendEvent(ctx, components.workflow, {
      name: `approve:${jobId}:${stepId}`,
      workflowId: job.workflowId as unknown as import("@convex-dev/workflow").WorkflowId,
    });
    return null;
  },
});
