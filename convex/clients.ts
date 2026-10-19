import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * Invite-only, enforced in two places on purpose.
 *
 * Supabase decides whether someone can sign in at all. The `clients` table
 * decides whether a signed-in identity has anything here -- so a valid
 * Supabase JWT with no client row gets nothing, and revoking access is a row
 * edit rather than an auth-provider change.
 */

/** Default cap for a newly admitted client. Deliberately low; raise per client. */
const DEFAULT_MONTHLY_CAP_USD = 50;

/**
 * Temporary: sign-in is switched off (see AUTH_DISABLED in
 * ConvexClientProvider.tsx), so there is no real identity to look up. Falls
 * back to the one real client row instead of a `dev:`-prefixed test fixture
 * or the `__probe__` row. Flip back to `false` to re-enable sign-in.
 */
const AUTH_DISABLED = true;

/** Shared with `getByAuthUserId`: the stand-in client while AUTH_DISABLED. */
async function fallbackClient(ctx: QueryCtx | MutationCtx): Promise<Doc<"clients"> | null> {
  if (!AUTH_DISABLED) return null;
  const clients = await ctx.db.query("clients").collect();
  return (
    clients.find(
      (c) => !c.archived && !c.authUserId.startsWith("dev:") && c.authUserId !== "__probe__",
    ) ?? null
  );
}

export async function currentClient(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"clients"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    return ctx.db
      .query("clients")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", identity.subject))
      .unique();
  }
  return fallbackClient(ctx);
}

export async function requireClient(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"clients">> {
  const client = await currentClient(ctx);
  if (!client) {
    throw new Error("Not authorized. This is an invite-only tool.");
  }
  if (client.archived) {
    throw new Error("This account has been archived.");
  }
  return client;
}

/**
 * `requireClient` needs `ctx.db`, which an action doesn't have -- an action
 * only gets `ctx.auth`. This is the same lookup, reachable via `ctx.runQuery`
 * from any action that needs client identity. `authUserId` is optional so a
 * signed-out caller (AUTH_DISABLED) can still resolve to the fallback client.
 */
export const getByAuthUserId = internalQuery({
  args: { authUserId: v.optional(v.string()) },
  handler: async (ctx, { authUserId }) => {
    if (authUserId) {
      const client = await ctx.db
        .query("clients")
        .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
        .unique();
      if (client) return client.archived ? null : client;
    }
    return fallbackClient(ctx);
  },
});

/**
 * `requireClient` for an action. Looks the client up through
 * `getByAuthUserId` (actions have no `ctx.db`) and throws the same
 * invite-only error `requireClient` does when there is none.
 */
export async function requireClientForAction(ctx: ActionCtx): Promise<Doc<"clients">> {
  const identity = await ctx.auth.getUserIdentity();
  const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
    authUserId: identity?.subject,
  });
  if (!client) throw new Error("Not authorized. This is an invite-only tool.");
  return client;
}

/**
 * Every client with a Zernio profile -- the cron's worklist. A client with no
 * profile has never connected a social account, so there is nothing for the
 * analytics sync to fetch.
 */
export const listWithZernioProfile = internalQuery({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    return clients
      .filter((c) => !c.archived && c.zernioProfileId)
      .map((c) => ({ _id: c._id, zernioProfileId: c.zernioProfileId! }));
  },
});

/**
 * Whether the invite-only gate has admitted anyone yet -- lets the frontend
 * skip even attempting `bootstrapFirstClient` once that's settled, instead of
 * calling a mutation that can only fail from then on. Convex's client logs a
 * mutation's server-side error to the console regardless of whether the
 * caller catches the rejection, so a doomed call is not just wasted, it is a
 * console error on every load for every non-owner.
 */
export const anyClientExists = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("clients").first()) !== null,
});

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
      authUserId: identity.subject,
      displayName: displayName ?? identity.name ?? identity.email ?? "Owner",
      monthlySpendCapUsd: DEFAULT_MONTHLY_CAP_USD,
    });
  },
});
