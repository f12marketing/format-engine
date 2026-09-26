import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireClient } from "./clients";
import * as zernio from "./lib/zernio";
import { jobShowsAiPerson } from "./lib/disclosure";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";

/**
 * Composed posts and their journey out to the platforms.
 *
 * Zernio is the scheduler: a post handed over with a `scheduledFor` is
 * Zernio's responsibility from then on, including the retries. These rows are
 * a local mirror so the Library and Calendar read from one reactive query,
 * reconciled by the webhook in http.ts with a cron backstop for the
 * deliveries that never arrive (local dev never receives them at all).
 */

const TARGET = v.object({
  platform: v.string(),
  zernioAccountId: v.string(),
  socialAccountId: v.id("socialAccounts"),
  status: v.string(),
  platformPostUrl: v.optional(v.string()),
  error: v.optional(v.string()),
  platformSpecificData: v.optional(v.any()),
});

// ------------------------------------------------------------------- reading

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, status }) => {
    const client = await requireClient(ctx);
    const page = status
      ? await ctx.db
          .query("socialPosts")
          .withIndex("by_client_and_status", (q) =>
            q.eq("clientId", client._id).eq("status", status as "draft"),
          )
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("socialPosts")
          .withIndex("by_client", (q) => q.eq("clientId", client._id))
          .order("desc")
          .paginate(paginationOpts);
    return page;
  },
});

/**
 * Posts whose scheduled time falls inside a window -- the Calendar's month
 * view. Filtered on `scheduledFor` alone, not status: a draft with no time
 * picked yet has no `scheduledFor` and so is absent, same as any other post
 * with none -- but the composer's "Save draft" button doesn't clear a time
 * you already picked, so a draft that has one still shows up here, on its
 * own day, same as a scheduled post would.
 */
export const inRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const client = await requireClient(ctx);
    return ctx.db
      .query("socialPosts")
      .withIndex("by_client_and_scheduled", (q) =>
        q.eq("clientId", client._id).gte("scheduledFor", from).lte("scheduledFor", to),
      )
      .collect();
  },
});

export const get = query({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const client = await requireClient(ctx);
    const post = await ctx.db.get(postId);
    // Scoped by client, not just by id -- an id is not an authorisation.
    if (!post || post.clientId !== client._id) return null;
    return post;
  },
});

/**
 * Whether the media being posted shows an AI-generated person, which turns
 * the composer's caption disclosure on by default (see lib/disclosure.ts).
 * Read from the job that made it -- the one the post names, or the one each
 * asset was produced by, for a post composed from the Library.
 */
export const disclosure = query({
  args: { jobId: v.optional(v.id("jobs")), mediaAssetIds: v.array(v.id("assets")) },
  handler: async (ctx, { jobId, mediaAssetIds }): Promise<{ aiPerson: boolean }> => {
    const client = await requireClient(ctx);
    const jobIds = new Set<Id<"jobs">>(jobId ? [jobId] : []);
    for (const assetId of mediaAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (asset?.clientId === client._id && asset.producedByJobId) jobIds.add(asset.producedByJobId);
    }
    for (const id of jobIds) {
      const job = await ctx.db.get(id);
      if (job?.clientId === client._id && jobShowsAiPerson(job)) return { aiPerson: true };
    }
    return { aiPerson: false };
  },
});

// ------------------------------------------------------------------- writing

export const createDraft = mutation({
  args: {
    caption: v.string(),
    mediaAssetIds: v.array(v.id("assets")),
    jobId: v.optional(v.id("jobs")),
    targets: v.array(TARGET),
    scheduledFor: v.optional(v.number()),
    timezone: v.optional(v.string()),
    aiLabel: v.optional(v.object({ burn: v.boolean(), metadata: v.boolean() })),
  },
  handler: async (ctx, args) => {
    const client = await requireClient(ctx);

    // Every referenced asset and account must belong to this client, or a
    // crafted call could publish someone else's video through their account.
    for (const assetId of args.mediaAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.clientId !== client._id) throw new Error("Unknown asset.");
    }
    for (const target of args.targets) {
      const account = await ctx.db.get(target.socialAccountId);
      if (!account || account.clientId !== client._id) throw new Error("Unknown account.");
    }

    return ctx.db.insert("socialPosts", {
      clientId: client._id,
      status: "draft",
      caption: args.caption,
      mediaAssetIds: args.mediaAssetIds,
      jobId: args.jobId,
      scheduledFor: args.scheduledFor,
      timezone: args.timezone,
      targets: args.targets.map((t) => ({ ...t, status: "pending" })),
      aiLabel: args.aiLabel && (args.aiLabel.burn || args.aiLabel.metadata) ? args.aiLabel : undefined,
    });
  },
});

/** What is actually posted: the labeled copies once they exist, else the originals. */
export const getForSchedule = internalQuery({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const media = await Promise.all(
      (post.postedMediaAssetIds ?? post.mediaAssetIds).map(async (id) => {
        const asset = await ctx.db.get(id);
        if (!asset) return null;
        return {
          id,
          kind: asset.kind,
          producedByJobId: asset.producedByJobId,
          // Convex storage URLs are permanent, unguessable and need no auth
          // header -- which is exactly Zernio's "publicly reachable HTTPS URL
          // that returns the file". The same trick already hands videos to
          // fal's remote API (see characterSwap.ts).
          url: await ctx.storage.getUrl(asset.storageId),
        };
      }),
    );
    return { post, media: media.filter((m) => m !== null) };
  },
});

export const markScheduled = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    zernioPostId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, { postId, zernioPostId, status }) => {
    await ctx.db.patch(postId, {
      zernioPostId,
      status: status as "scheduled",
      lastError: undefined,
    });
  },
});

export const setPostedMedia = internalMutation({
  args: { postId: v.id("socialPosts"), assetIds: v.array(v.id("assets")) },
  handler: async (ctx, { postId, assetIds }) => {
    await ctx.db.patch(postId, { postedMediaAssetIds: assetIds });
  },
});

/**
 * The composer's AI-label choices applied, once per post: each video (and,
 * when burning, each image) goes through the render service's /label/ai and
 * the copy is what gets posted. Anything left as it is keeps its own id.
 */
async function labelPostMedia(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  aiLabel: { burn: boolean; metadata: boolean },
  media: { id: Id<"assets">; kind: string; url: string | null; producedByJobId?: Id<"jobs"> }[],
): Promise<Id<"assets">[]> {
  const base = renderServiceBase();
  const health = await fetch(`${base}/health`)
    .then((r) => (r.ok ? (r.json() as Promise<{ aiLabel?: boolean }>) : null))
    .catch(() => null);
  if (!health) throw new Error(`Could not reach the render service at ${base} to add the AI label.`);
  if (health.aiLabel !== true) {
    throw new Error(
      "The render service is running old code that can't add the AI label. Restart it " +
        "(cd ../render-service && npm start), or redeploy it, and schedule again.",
    );
  }

  const ids: Id<"assets">[] = [];
  for (const m of media) {
    const kind = m.kind === "video" ? "video" : m.kind === "image" ? "image" : null;
    // An image can't carry the metadata tag, so only a burned badge changes it.
    if (!kind || !m.url || (kind === "image" && !aiLabel.burn)) {
      ids.push(m.id);
      continue;
    }
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/label/ai`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({ mediaUrl: m.url, kind, burn: aiLabel.burn, metadata: aiLabel.metadata, uploadUrl }),
    });
    if (!res.ok) throw new Error(`Adding the AI label failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const out = (await res.json()) as {
      storageId: Id<"_storage">;
      width: number;
      height: number;
      bytes: number;
      contentType: string;
    };
    ids.push(
      await ctx.runMutation(internal.assets.record, {
        clientId,
        // Same provenance as the original, so the copy still reads as that job's output.
        producedByJobId: m.producedByJobId,
        storageId: out.storageId,
        mimeType: out.contentType,
        bytes: out.bytes,
        width: out.width,
        height: out.height,
      }),
    );
  }
  return ids;
}

export const markFailed = internalMutation({
  args: { postId: v.id("socialPosts"), error: v.string() },
  handler: async (ctx, { postId, error }) => {
    await ctx.db.patch(postId, { status: "failed", lastError: error });
  },
});

/**
 * Hands a draft to Zernio. An action because it talks to the network, so the
 * ownership check has to run as a query first rather than reading ctx.db.
 */
export const schedule = action({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }): Promise<{ zernioPostId: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");

    let loaded = await ctx.runQuery(internal.socialPosts.getForSchedule, { postId });
    if (!loaded || loaded.post.clientId !== client._id) throw new Error("Not found.");
    if (!loaded.media.length) throw new Error("A post needs at least one video or image.");

    // The AI label, if the composer asked for one: made once, then reused
    // by every later attempt to schedule this post.
    if (loaded.post.aiLabel && !loaded.post.postedMediaAssetIds) {
      const assetIds = await labelPostMedia(ctx, client._id, loaded.post.aiLabel, loaded.media);
      await ctx.runMutation(internal.socialPosts.setPostedMedia, { postId, assetIds });
      loaded = await ctx.runQuery(internal.socialPosts.getForSchedule, { postId });
      if (!loaded) throw new Error("Not found.");
    }
    const { post, media } = loaded;

    // Each target carries its own settings: Zernio reads them only on the
    // `platforms[]` entry, never from a root-level object keyed by platform.
    const platforms = post.targets.map((t) => ({
      platform: t.platform,
      accountId: t.zernioAccountId,
      platformSpecificData: zernio.zernioPlatformData(t.platform, t.platformSpecificData),
    }));
    const mediaItems = media.map((m) => ({
      url: m.url as string,
      type: m.kind === "video" ? ("video" as const) : ("image" as const),
    }));

    try {
      // Dry-run Zernio's own publish pipeline before spending a real create
      // call on it -- catches platform rules this app doesn't hardcode
      // (hashtag limits, thread formats, Reel requirements) with the same
      // authority publish itself would enforce, instead of only finding out
      // from a failed post.
      const validation = await zernio.validatePost({
        content: post.caption,
        platforms,
        mediaItems,
      });
      if (!validation.valid) {
        throw new Error(validation.errors.map((e) => `${e.platform}: ${e.error}`).join("; "));
      }

      const created = await zernio.createPost({
        content: post.caption,
        platforms,
        mediaItems,
        scheduledFor: post.scheduledFor
          ? new Date(post.scheduledFor).toISOString()
          : undefined,
        timezone: post.timezone,
      });

      await ctx.runMutation(internal.socialPosts.markScheduled, {
        postId,
        zernioPostId: created._id,
        status: created.status ?? "scheduled",
      });
      return { zernioPostId: created._id };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.socialPosts.markFailed, { postId, error: message });
      throw e;
    }
  },
});

export const applyReschedule = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    scheduledFor: v.number(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { postId, scheduledFor, timezone }) => {
    await ctx.db.patch(postId, { scheduledFor, timezone });
  },
});

/**
 * Moves a post to a new time. Draft posts only touch our row; a post Zernio
 * already holds has to be told, or it publishes at the old time regardless of
 * what the calendar shows.
 */
export const reschedule = action({
  args: {
    postId: v.id("socialPosts"),
    scheduledFor: v.number(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { postId, scheduledFor, timezone }): Promise<void> => {
    const post = await requireOwnPost(ctx, postId);

    if (post.zernioPostId) {
      await zernio.updatePost(post.zernioPostId, {
        scheduledFor: new Date(scheduledFor).toISOString(),
        timezone: timezone ?? post.timezone,
      });
    }
    await ctx.runMutation(internal.socialPosts.applyReschedule, {
      postId,
      scheduledFor,
      timezone: timezone ?? post.timezone,
    });
  },
});

export const applyCancel = internalMutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    await ctx.db.patch(postId, { status: "cancelled" });
  },
});

export const cancel = action({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }): Promise<void> => {
    const post = await requireOwnPost(ctx, postId);
    // Already out the door -- cancelling here would only lie to the calendar.
    if (post.status === "published") {
      throw new Error("That post has already published.");
    }
    if (post.zernioPostId) await zernio.cancelPost(post.zernioPostId);
    await ctx.runMutation(internal.socialPosts.applyCancel, { postId });
  },
});

export const resetForRetry = internalMutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return;
    await ctx.db.patch(postId, {
      status: "draft",
      // A new Zernio post is created on the next schedule; keeping the old id
      // would have the webhook apply that dead post's events to this row.
      zernioPostId: undefined,
      lastError: undefined,
      targets: post.targets.map((t) => ({
        ...t,
        status: "pending",
        error: undefined,
      })),
    });
  },
});

/**
 * Puts a failed or partly-failed post back to draft so it can be scheduled
 * again. Deliberately not automatic: a post usually fails because something
 * about it was wrong, and silently retrying the same thing just fails twice.
 */
export const retryFailed = action({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }): Promise<void> => {
    const post = await requireOwnPost(ctx, postId);
    if (post.status !== "failed" && post.status !== "partial") {
      throw new Error("Only a failed post can be retried.");
    }
    await ctx.runMutation(internal.socialPosts.resetForRetry, { postId });
  },
});

export const getInternal = internalQuery({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => ctx.db.get(postId),
});

/**
 * The ownership check every action here starts with. An action has no
 * `ctx.db`, so this is the query hop that `requireClient` would otherwise be --
 * and an id is not an authorisation, so the post's own `clientId` is what
 * decides, never the id the caller passed.
 */
async function requireOwnPost(ctx: ActionCtx, postId: Id<"socialPosts">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
  const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
    authUserId: identity.subject,
  });
  if (!client) throw new Error("Not authorized. This is an invite-only tool.");

  const post = await ctx.runQuery(internal.socialPosts.getInternal, { postId });
  if (!post || post.clientId !== client._id) throw new Error("Not found.");
  return post;
}

// ------------------------------------------------------------------ webhooks

/**
 * Applies one Zernio event, ignoring anything already seen.
 *
 * Zernio delivers at least once and retries up to seven times, so the same
 * event id will arrive twice sooner or later; recording the id in the same
 * transaction that applies the change is what makes a replay a no-op.
 */
export const applyWebhookEvent = internalMutation({
  args: { eventId: v.string(), event: v.string(), payload: v.any() },
  handler: async (ctx, { eventId, event, payload }) => {
    const seen = await ctx.db
      .query("zernioWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
      .unique();
    if (seen) return;
    await ctx.db.insert("zernioWebhookEvents", {
      eventId,
      event,
      receivedAt: Date.now(),
    });

    const zernioPostId: string | undefined = payload?._id ?? payload?.postId;
    if (!zernioPostId) return;

    const post = await ctx.db
      .query("socialPosts")
      .withIndex("by_zernio_post", (q) => q.eq("zernioPostId", zernioPostId))
      .unique();
    // A post this deployment never created -- another app on the same Zernio
    // team, most likely. Recording the event id above still dedupes it.
    if (!post) return;

    const remoteTargets: { platform?: string; status?: string; postUrl?: string; error?: string }[] =
      payload?.platforms ?? [];

    const targets = post.targets.map((t) => {
      const remote = remoteTargets.find((r) => r.platform === t.platform);
      if (!remote) return t;
      return {
        ...t,
        status: remote.status ?? t.status,
        platformPostUrl: remote.postUrl ?? t.platformPostUrl,
        error: remote.error ?? t.error,
      };
    });

    const status = (payload?.status as string) ?? post.status;
    await ctx.db.patch(post._id, {
      status: status as "published",
      targets,
      publishedAt: status === "published" ? Date.now() : post.publishedAt,
      lastError: targets.find((t) => t.error)?.error,
    });
  },
});

/**
 * Backstop for deliveries that never arrive. Local dev never receives a
 * webhook at all (Convex's site URL is 127.0.0.1 there), and even in
 * production Zernio can exhaust its retries -- so anything left mid-flight is
 * re-read from Zernio directly, the same shape as
 * `influencers.reconcileStuckTrainings`.
 */
export const reconcileInFlight = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const stuck = await ctx.runQuery(internal.socialPosts.listInFlight, {});
    for (const { zernioPostId } of stuck) {
      if (!zernioPostId) continue;
      try {
        const remote = await zernio.getPost(zernioPostId);
        await ctx.runMutation(internal.socialPosts.applyWebhookEvent, {
          // Synthetic id so a later real webhook for the same transition is
          // still deduped against a stable key rather than firing twice.
          eventId: `reconcile:${zernioPostId}:${remote.status}`,
          event: "post.reconciled",
          payload: remote,
        });
      } catch {
        // Leave it for the next run rather than failing the whole sweep.
      }
    }
  },
});

export const listInFlight = internalQuery({
  args: {},
  handler: async (ctx) => {
    const scheduled = await ctx.db
      .query("socialPosts")
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "scheduled"),
          q.eq(q.field("status"), "publishing"),
        ),
      )
      .take(100);
    return scheduled.map((p) => ({ zernioPostId: p.zernioPostId }));
  },
});
