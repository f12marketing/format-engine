import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";
import * as zernio from "./lib/zernio";

/**
 * Connected social accounts, and the OAuth handoff that creates them.
 *
 * Nothing here ever holds a platform token -- Zernio does. What this file
 * owns is the mapping from a Convex client to a Zernio profile, and a local
 * mirror of that profile's accounts so the UI has something reactive to read.
 */

const PLATFORM = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
);

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    return listActiveAccounts(ctx, client._id);
  },
});

/** Same lookup, for the analytics cron -- which has no caller identity to route through `requireClient`. */
export const listAccountsInternal = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => listActiveAccounts(ctx, clientId),
});

async function listActiveAccounts(ctx: QueryCtx, clientId: Id<"clients">) {
  const accounts = await ctx.db
    .query("socialAccounts")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  return accounts.filter((a) => !a.disconnectedAt);
}

/**
 * Whether the deployment can talk to Zernio at all. The connections page asks
 * before offering buttons that could only throw.
 */
export const configured = query({
  args: {},
  handler: async () => zernio.zernioConfigured(),
});

export const getProfileId = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const client = await ctx.db.get(clientId);
    return client?.zernioProfileId ?? null;
  },
});

export const setProfileId = internalMutation({
  args: { clientId: v.id("clients"), zernioProfileId: v.string() },
  handler: async (ctx, { clientId, zernioProfileId }) => {
    await ctx.db.patch(clientId, { zernioProfileId });
  },
});

/**
 * Starts the OAuth handoff, creating the client's Zernio profile on first use.
 *
 * Lazy rather than created at admission so existing clients need no backfill,
 * and so a deployment without a Zernio key still works for everything that
 * isn't social.
 */
export const startConnect = action({
  args: { platform: PLATFORM, redirectUrl: v.string() },
  handler: async (ctx, { platform, redirectUrl }): Promise<{ authUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorised. This is an invite-only tool.");

    let profileId = client.zernioProfileId;
    if (!profileId) {
      profileId = await zernio.createProfile(client.displayName);
      await ctx.runMutation(internal.social.setProfileId, {
        clientId: client._id,
        zernioProfileId: profileId,
      });
    }

    return { authUrl: await zernio.connectUrl(platform, profileId, redirectUrl) };
  },
});

/**
 * Called by the OAuth return route once the user comes back from the
 * platform. Re-reads the account list from Zernio rather than trusting the
 * query string, so what we store is what Zernio actually has.
 */
export const syncAccounts = action({
  args: {},
  handler: async (ctx): Promise<{ synced: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorised. This is an invite-only tool.");
    if (!client.zernioProfileId) return { synced: 0 };

    const remote = await zernio.listAccounts(client.zernioProfileId);
    await ctx.runMutation(internal.social.applyAccountSync, {
      clientId: client._id,
      accounts: remote
        .filter((a) =>
          (zernio.SUPPORTED_PLATFORMS as string[]).includes(a.platform),
        )
        .map((a) => ({
          zernioAccountId: a._id,
          platform: a.platform,
          username: a.username,
          displayName: a.displayName,
          avatarUrl: a.avatarUrl,
          isActive: a.isActive,
        })),
    });
    return { synced: remote.length };
  },
});

/**
 * Reconciles the local mirror against Zernio's list: upsert what's there,
 * mark what isn't as disconnected. Rows are never deleted -- a published post
 * still points at the account it went out through.
 */
export const applyAccountSync = internalMutation({
  args: {
    clientId: v.id("clients"),
    accounts: v.array(
      v.object({
        zernioAccountId: v.string(),
        platform: v.string(),
        username: v.string(),
        displayName: v.optional(v.string()),
        avatarUrl: v.optional(v.string()),
        isActive: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { clientId, accounts }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("socialAccounts")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();

    const seen = new Set<string>();
    for (const remote of accounts) {
      seen.add(remote.zernioAccountId);
      const match = existing.find((e) => e.zernioAccountId === remote.zernioAccountId);
      const platform = remote.platform as "tiktok" | "instagram" | "youtube" | "linkedin";
      if (match) {
        await ctx.db.patch(match._id, {
          username: remote.username,
          displayName: remote.displayName,
          avatarUrl: remote.avatarUrl,
          isActive: remote.isActive,
          lastCheckedAt: now,
          disconnectedAt: undefined,
        });
      } else {
        await ctx.db.insert("socialAccounts", {
          clientId,
          zernioAccountId: remote.zernioAccountId,
          platform,
          username: remote.username,
          displayName: remote.displayName,
          avatarUrl: remote.avatarUrl,
          isActive: remote.isActive,
          connectedAt: now,
          lastCheckedAt: now,
        });
      }
    }

    for (const row of existing) {
      if (!seen.has(row.zernioAccountId) && !row.disconnectedAt) {
        await ctx.db.patch(row._id, { disconnectedAt: now, isActive: false });
      }
    }
  },
});

export const disconnect = action({
  args: { socialAccountId: v.id("socialAccounts") },
  handler: async (ctx, { socialAccountId }): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorised. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorised. This is an invite-only tool.");

    // An id is not an authorisation -- confirm this row is actually theirs
    // before asking Zernio to drop the account behind it.
    const account = await ctx.runQuery(internal.social.getAccount, { socialAccountId });
    if (!account || account.clientId !== client._id) {
      throw new Error("Not found.");
    }

    await zernio.disconnectAccount(account.zernioAccountId);
    await ctx.runMutation(internal.social.markDisconnected, { socialAccountId });
  },
});

export const getAccount = internalQuery({
  args: { socialAccountId: v.id("socialAccounts") },
  handler: async (ctx, { socialAccountId }) => ctx.db.get(socialAccountId),
});

export const markDisconnected = internalMutation({
  args: { socialAccountId: v.id("socialAccounts") },
  handler: async (ctx, { socialAccountId }) => {
    await ctx.db.patch(socialAccountId, {
      disconnectedAt: Date.now(),
      isActive: false,
    });
  },
});
