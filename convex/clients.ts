import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Invite-only, enforced in two places on purpose.
 *
 * Clerk decides whether someone can sign in at all. The `clients` table decides
 * whether a signed-in identity has anything here -- so a valid Clerk token with
 * no client row gets nothing, and revoking access is a row edit rather than an
 * auth-provider change.
 */

/** Default cap for a newly admitted client. Deliberately low; raise per client. */
const DEFAULT_MONTHLY_CAP_USD = 50;

export async function currentClient(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"clients"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("clients")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .unique();
}

export async function requireClient(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"clients">> {
  const client = await currentClient(ctx);
  if (!client) {
    throw new Error("Not authorised. This is an invite-only tool.");
  }
  if (client.archived) {
    throw new Error("This account has been archived.");
  }
  return client;
}

export const me = query({
  args: {},
  handler: async (ctx) => {
    const client = await currentClient(ctx);
    if (!client) return null;
    return {
      id: client._id,
      displayName: client.displayName,
      monthlySpendCapUsd: client.monthlySpendCapUsd,
      archived: client.archived ?? false,
    };
  },
});

/**
 * Admits the first signed-in user as a client.
 *
 * Only ever creates a row when the table is empty -- that is the bootstrap for
 * you, the owner. Every client after that is added deliberately, from the
 * Convex dashboard or a script, because "a stranger signed in" should never be
 * enough to get an account in an invite-only tool.
 */
export const bootstrapFirstClient = mutation({
  args: { displayName: v.optional(v.string()) },
  handler: async (ctx, { displayName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in first.");

    const existing = await currentClient(ctx);
    if (existing) return existing._id;

    const anyClient = await ctx.db.query("clients").first();
    if (anyClient) {
      throw new Error(
        "This tool is invite-only. Ask the owner to add you from the Convex dashboard.",
      );
    }

    return ctx.db.insert("clients", {
      clerkUserId: identity.subject,
      displayName: displayName ?? identity.name ?? identity.email ?? "Owner",
      monthlySpendCapUsd: DEFAULT_MONTHLY_CAP_USD,
    });
  },
});
