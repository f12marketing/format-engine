import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
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
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", `dev:${displayName}`))
      .unique();
    if (existing) return existing._id;

    return ctx.db.insert("clients", {
      // Namespaced so a dev row can never collide with a real Clerk subject.
      clerkUserId: `dev:${displayName}`,
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
      renderedFiles:
        (job.steps.find((s) => s.id === "render")?.output as
          | { files?: { name: string }[] }
          | undefined)?.files?.map((f) => f.name) ?? [],
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
