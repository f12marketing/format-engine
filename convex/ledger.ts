import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClient } from "./clients";

/**
 * Spend tracking, and the two brakes on it.
 *
 * This lands in Phase 0 rather than later because two settled decisions make
 * it load-bearing from the first paid call: remix regenerates assets, so every
 * retake is full price, and duration is freely selectable to 60s, so nothing
 * bounds the worst case. A retry loop on an avatar format can burn a hundred
 * dollars unattended. Ten lines here is the cheapest insurance in the system.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rolling 30 days rather than calendar month -- no month-boundary reset to reason about. */
function windowStart(now: number): number {
  return now - 30 * MS_PER_DAY;
}

function sumSpend(rows: Doc<"spend_ledger">[]): number {
  // Reversals are stored as their own negative-cost rows, so a plain sum is
  // already the net figure. Character Swap's "if it isn't swapped we don't
  // charge you" rule depends on this staying true.
  return rows.reduce((total, r) => total + r.costUsd, 0);
}

/** What this client has spent in the last 30 days, and what's left. */
export const monthToDate = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const since = windowStart(Date.now());
    const rows = await ctx.db
      .query("spend_ledger")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .collect();
    const recent = rows.filter((r) => r._creationTime >= since);
    const spent = sumSpend(recent);
    return {
      spentUsd: spent,
      capUsd: client.monthlySpendCapUsd,
      remainingUsd: Math.max(0, client.monthlySpendCapUsd - spent),
    };
  },
});

export const spendForClient = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const since = windowStart(Date.now());
    const rows = await ctx.db
      .query("spend_ledger")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();
    return sumSpend(rows.filter((r) => r._creationTime >= since));
  },
});

/**
 * Called before a paid step runs, never after. Throwing here costs nothing;
 * throwing afterwards means the money is already gone.
 */
export const assertUnderCap = internalMutation({
  args: { clientId: v.id("clients"), aboutToSpendUsd: v.number() },
  handler: async (ctx, { clientId, aboutToSpendUsd }) => {
    const client = await ctx.db.get(clientId);
    if (!client) throw new Error("unknown client");

    const since = windowStart(Date.now());
    const rows = await ctx.db
      .query("spend_ledger")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();
    const spent = sumSpend(rows.filter((r) => r._creationTime >= since));

    if (spent + aboutToSpendUsd > client.monthlySpendCapUsd) {
      throw new Error(
        `Spend cap reached: $${spent.toFixed(2)} of $${client.monthlySpendCapUsd.toFixed(2)} ` +
          `used in the last 30 days, and this step would add $${aboutToSpendUsd.toFixed(2)}.`,
      );
    }
  },
});

/**
 * Written in the same transaction that records the step's completion, so the
 * ledger can never drift from what actually ran.
 */
export const record = internalMutation({
  args: {
    clientId: v.id("clients"),
    jobId: v.id("jobs"),
    stepId: v.string(),
    primitive: v.string(),
    model: v.string(),
    units: v.number(),
    unitLabel: v.string(),
    costUsd: v.number(),
    reversalOfId: v.optional(v.id("spend_ledger")),
  },
  handler: async (ctx, args): Promise<Id<"spend_ledger">> => {
    const id = await ctx.db.insert("spend_ledger", args);

    // Keep the job's running total in step with its rows.
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(args.jobId, { costUsd: job.costUsd + args.costUsd });
    }
    return id;
  },
});

/**
 * A refund is a first-class negative row, not an edit to the original. The
 * original stays as evidence of what ran; the reversal points at it.
 */
export const reverse = internalMutation({
  args: { ledgerId: v.id("spend_ledger"), reason: v.string() },
  handler: async (ctx, { ledgerId }) => {
    const original = await ctx.db.get(ledgerId);
    if (!original) throw new Error("unknown ledger row");
    if (original.reversalOfId) throw new Error("cannot reverse a reversal");

    await ctx.db.insert("spend_ledger", {
      ...original,
      costUsd: -original.costUsd,
      reversalOfId: ledgerId,
    });

    const job = await ctx.db.get(original.jobId);
    if (job) {
      await ctx.db.patch(original.jobId, { costUsd: job.costUsd - original.costUsd });
    }
  },
});
