import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

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

export async function currentClient(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"clients"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("clients")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", identity.subject))
    .unique();
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
 * from the one place so far that needs client identity inside an action
 * (`avatars.generate`, which calls fal directly and so must be an action).
 */
export const getByAuthUserId = internalQuery({
  args: { authUserId: v.string() },
  handler: async (ctx, { authUserId }) => {
    const client = await ctx.db
      .query("clients")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique();
    return client && !client.archived ? client : null;
  },
});

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
