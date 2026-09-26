import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";
import * as zernio from "./lib/zernio";

/**
 * Performance data, read two different ways for two different jobs.
 *
 * `postAnalytics` (daily/platform rollups) drives the KPI tiles, the growth
 * charts and the By Platform breakdown -- Zernio already sums these across
 * every post for a day, so there is nothing to attribute.
 *
 * `socialPosts.targets[].analytics` (per-post, per-target numbers) drives By
 * Account and By Content Type -- the two things Zernio has no way to know,
 * since "format" and "which of our accounts" only exist on our side. Reading
 * these from two different sources rather than one joined table is what
 * keeps a KPI tile's sum from ever double-counting a post that also carries
 * its own per-target figures.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------- reading

export const dailyInRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const client = await requireClient(ctx);
    return ctx.db
      .query("postAnalytics")
      .withIndex("by_client_and_date", (q) =>
        q.eq("clientId", client._id).gte("date", from).lte("date", to),
      )
      .collect();
  },
});

export interface AttributionRow {
  postId: Id<"socialPosts">;
  formatId: string | undefined;
  platform: string;
  socialAccountId: Id<"socialAccounts">;
  username: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Scoped by `scheduledFor`, the only indexed temporal column on `socialPosts`
 * (the same field Calendar keys off). A post that published shortly after its
 * scheduled time is close enough for a reporting window.
 */
export const attributionInRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<AttributionRow[]> => {
    const client = await requireClient(ctx);
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_client_and_scheduled", (q) =>
        q.eq("clientId", client._id).gte("scheduledFor", from).lte("scheduledFor", to),
      )
      .collect();

    const accountCache = new Map<string, string>(); // socialAccountId -> username
    const formatCache = new Map<string, string | undefined>(); // jobId -> formatId
    const rows: AttributionRow[] = [];

    for (const post of posts) {
      if (post.status !== "published" && post.status !== "partial") continue;

      let formatId: string | undefined;
      if (post.jobId) {
        if (!formatCache.has(post.jobId)) {
          const job = await ctx.db.get(post.jobId);
          formatCache.set(post.jobId, job?.formatId);
        }
        formatId = formatCache.get(post.jobId);
      }

      for (const target of post.targets) {
        if (!target.analytics) continue;

        const key = target.socialAccountId;
        if (!accountCache.has(key)) {
          const account = await ctx.db.get(target.socialAccountId);
          accountCache.set(key, account?.username ?? "unknown");
        }

        rows.push({
          postId: post._id,
          formatId,
          platform: target.platform,
          socialAccountId: target.socialAccountId,
          username: accountCache.get(key)!,
          views: target.analytics.views,
          likes: target.analytics.likes,
          comments: target.analytics.comments,
          shares: target.analytics.shares,
        });
      }
    }

    return rows;
  },
});

// ------------------------------------------------------------------- syncing

export type SyncResult =
  | { ok: true; days: number; postsChecked: number }
  | { ok: false; reason: "no_key" | "addon_required" | "not_connected"; message: string };

/**
 * The shared sync, called both by the user's own "Refresh metrics" button and
 * the cron sweep across every client. Pulls the daily rollup once per
 * connected platform, then pages through per-post analytics and patches each
 * matched post's own targets.
 */
async function syncForClient(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  zernioProfileId: string,
  days: number,
): Promise<SyncResult> {
  if (!zernio.zernioConfigured()) {
    return { ok: false, reason: "no_key", message: "Zernio isn't configured on this deployment." };
  }

  const accounts = await ctx.runQuery(internal.social.listAccountsInternal, { clientId });
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  if (platforms.length === 0) {
    return { ok: false, reason: "not_connected", message: "No accounts connected yet." };
  }

  const toDate = toDateStr(Date.now());
  const fromDate = toDateStr(Date.now() - days * DAY_MS);

  try {
    for (const platform of platforms) {
      const { dailyData } = await zernio.getDailyMetrics({
        profileId: zernioProfileId,
        platform,
        fromDate,
        toDate,
        source: "late",
      });
      for (const day of dailyData) {
        await ctx.runMutation(internal.analytics.upsertDaily, {
          clientId,
          platform,
          date: day.date,
          postCount: day.postCount,
          views: day.metrics.views,
          likes: day.metrics.likes,
          comments: day.metrics.comments,
          shares: day.metrics.shares,
          impressions: day.metrics.impressions,
          reach: day.metrics.reach,
        });
      }
    }

    let postsChecked = 0;
    // Bounded rather than following every page: this is a reporting sync,
    // not a full-history backfill. Five pages at 100 posts comfortably
    // covers a normal window without an unbounded loop against a paginated
    // upstream API that a stuck cursor could turn into a runaway one.
    for (let page = 1; page <= 5; page++) {
      const { posts } = await zernio.listPostAnalytics({
        profileId: zernioProfileId,
        fromDate,
        toDate,
        source: "late",
        limit: 100,
        page,
      });
      if (posts.length === 0) break;

      for (const post of posts) {
        postsChecked++;
        await ctx.runMutation(internal.analytics.applyPostAnalytics, {
          zernioPostId: post.postId,
          targets: post.platformAnalytics.map((p) => ({
            zernioAccountId: p.accountId,
            views: p.analytics.views,
            likes: p.analytics.likes,
            comments: p.analytics.comments,
            shares: p.analytics.shares,
          })),
        });
      }
      if (posts.length < 100) break;
    }

    return { ok: true, days, postsChecked };
  } catch (e) {
    if (e instanceof zernio.ZernioApiError && e.status === 402) {
      return { ok: false, reason: "addon_required", message: e.message };
    }
    throw e;
  }
}

/** The "Refresh metrics" button. A wider window than the cron's, since this runs rarely and on demand. */
export const syncNow = action({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }): Promise<SyncResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");
    if (!client.zernioProfileId) {
      return { ok: false, reason: "not_connected", message: "Connect an account first." };
    }
    return syncForClient(ctx, client._id, client.zernioProfileId, days ?? 30);
  },
});

/** The hourly cron's worklist walk. One client failing (a revoked token, a transient 5xx) must not stop the rest. */
export const syncAllClients = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const clients = await ctx.runQuery(internal.clients.listWithZernioProfile, {});
    for (const c of clients) {
      try {
        await syncForClient(ctx, c._id, c.zernioProfileId, 2);
      } catch {
        // Logged by Convex's own action failure reporting; the sweep continues.
      }
    }
  },
});

export const upsertDaily = internalMutation({
  args: {
    clientId: v.id("clients"),
    platform: v.string(),
    date: v.string(),
    postCount: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    impressions: v.number(),
    reach: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("postAnalytics")
      .withIndex("by_client_platform_date", (q) =>
        q.eq("clientId", args.clientId).eq("platform", args.platform).eq("date", args.date),
      )
      .first();
    const row = { ...args, syncedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("postAnalytics", row);
  },
});

export const applyPostAnalytics = internalMutation({
  args: {
    zernioPostId: v.string(),
    targets: v.array(
      v.object({
        zernioAccountId: v.string(),
        views: v.number(),
        likes: v.number(),
        comments: v.number(),
        shares: v.number(),
      }),
    ),
  },
  handler: async (ctx, { zernioPostId, targets }) => {
    const post = await ctx.db
      .query("socialPosts")
      .withIndex("by_zernio_post", (q) => q.eq("zernioPostId", zernioPostId))
      .unique();
    // A post from another app on the same Zernio team -- nothing of ours to update.
    if (!post) return;

    const now = Date.now();
    const nextTargets = post.targets.map((t) => {
      const match = targets.find((m) => m.zernioAccountId === t.zernioAccountId);
      if (!match) return t;
      return {
        ...t,
        analytics: {
          views: match.views,
          likes: match.likes,
          comments: match.comments,
          shares: match.shares,
          syncedAt: now,
        },
      };
    });
    await ctx.db.patch(post._id, { targets: nextTargets });
  },
});
