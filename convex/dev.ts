import { v } from "convex/values";
import { sendEvent } from "@convex-dev/workflow";
import { components } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STARTERS, type RunnableFormatId } from "./starters";
import * as zernio from "./lib/zernio";

/**
 * Dev-only helpers, callable from the CLI with `npx convex run`.
 *
 * These are `internal*` on purpose: they are unreachable from the browser and
 * from any client SDK, so they cannot become a back door around the
 * invite-only check in clients.ts. They exist so the pipeline can be exercised
 * end to end before Clerk is configured, which is otherwise a chicken and egg.
 */

/**
 * Admits a real signed-in identity as a client. `clients.bootstrapFirstClient`
 * only ever works once, for whoever signs in while the table is empty --
 * dev-seeded rows from CLI testing (`seedClient`, namespaced "dev:...") burn
 * that slot, so the actual owner's real Supabase sign-in gets the honest
 * "invite-only" refusal too. This is the dashboard-row-edit the error message
 * points at, just scriptable: run it once with the owner's real Supabase user
 * id (Supabase Studio -> Authentication -> Users, after signing in once via
 * magic link) to admit them regardless of what else is already in the table.
 */
export const admitClient = internalMutation({
  args: { authUserId: v.string(), displayName: v.string(), capUsd: v.optional(v.number()) },
  handler: async (ctx, { authUserId, displayName, capUsd }): Promise<Id<"clients">> => {
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
      .unique();
    if (existing) return existing._id;

    return ctx.db.insert("clients", {
      authUserId,
      displayName,
      monthlySpendCapUsd: capUsd ?? 50,
    });
  },
});

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
/** A signed URL for any storage id, for eyeballing a stored file from the CLI. */
export const storageUrl = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<string | null> => ctx.storage.getUrl(storageId),
});

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

/**
 * Adds a clip to the shared house audio library from a public URL.
 *
 * Curation entry point until there's an admin surface, exactly as the clip
 * library started -- run it per track:
 *   npx convex run dev:addAudioTemplate '{"name":"Upbeat bed","url":"https://…/a.mp3"}'
 */
export const addAudioTemplate = internalAction({
  args: {
    name: v.string(),
    url: v.string(),
    tags: v.optional(v.array(v.string())),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, { name, url, tags, durationSec }): Promise<Id<"audioTemplates">> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`);
    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    return ctx.runMutation(internal.audio.recordTemplate, {
      name,
      storageId,
      mimeType,
      bytes: blob.size,
      durationSec,
      tags,
    });
  },
});

/**
 * Seeds a clip straight into the shared library from base64, bypassing
 * ScrapeCreators -- for exercising Video Hook & Demo / Green Screen Meme
 * before a SCRAPECREATORS_API_KEY exists. Dev-only, like everything else here.
 */
export const seedClip = internalAction({
  args: {
    base64: v.string(),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, { base64, durationSec, width, height }): Promise<Id<"clips">> => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const storageId = await ctx.storage.store(
      new Blob([bytes as unknown as BlobPart], { type: "video/mp4" }),
    );
    return ctx.runMutation(internal.clips.record, {
      source: "dev-seed",
      sourceUrl: "dev://seed",
      storageId,
      durationSec,
      width,
      height,
      tags: [],
    });
  },
});

/**
 * Inserts a job row with no starter invocation -- for calling a single step
 * action directly (e.g. `cuttingFruit:composeKitchenScene`) against a real
 * row, without paying for or waiting on every other step in its pipeline.
 * `startJob` below is for exercising a whole pipeline; this is for one step.
 */
export const seedBareJob = internalMutation({
  args: {
    clientId: v.id("clients"),
    formatId: v.string(),
    config: v.any(),
    steps: v.array(v.object({ id: v.string(), primitive: v.string(), label: v.string() })),
  },
  handler: async (ctx, { clientId, formatId, config, steps }): Promise<Id<"jobs">> =>
    ctx.db.insert("jobs", {
      clientId,
      formatId,
      config,
      status: "running",
      steps: steps.map((s) => ({ ...s, state: "pending" as const })),
      costUsd: 0,
    }),
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
    const starter = STARTERS[formatId as RunnableFormatId];
    if (!starter) throw new Error(`no pipeline for ${formatId}`);
    await ctx.runMutation(starter, { jobId, clientId });
    return jobId;
  },
});

/** Triggers a TikTok clip ingestion from the CLI. Needs SCRAPECREATORS_API_KEY set. */
export const ingestTikTokClip = internalAction({
  args: { sourceUrl: v.string(), tags: v.optional(v.array(v.string())) },
  handler: async (ctx, { sourceUrl, tags }): Promise<Id<"clips">> =>
    ctx.runAction(internal.lib.clipIngest.ingestTikTok, { sourceUrl, tags }),
});

/** Auth-free equivalent of remix.remix, for exercising it from the CLI. */
export const remixJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    action: v.union(v.literal("remixVisuals"), v.literal("regenerateCopy")),
  },
  handler: async (ctx, { jobId, action }): Promise<Id<"jobs">> => {
    const COPY_PRIMITIVES = new Set(["P1"]);
    const ALWAYS_RERUN_PRIMITIVES = new Set(["P7", "P8"]);

    const source = await ctx.db.get(jobId);
    if (!source) throw new Error("job not found");
    if (source.status !== "done") throw new Error("Only a finished job can be remixed.");

    const starter = STARTERS[source.formatId as RunnableFormatId];
    if (!starter) throw new Error(`${source.formatId} has no pipeline.`);

    const keepDone = (primitive: string) =>
      action === "remixVisuals" ? COPY_PRIMITIVES.has(primitive) : !COPY_PRIMITIVES.has(primitive);

    const steps = source.steps.map((s) => {
      if (!ALWAYS_RERUN_PRIMITIVES.has(s.primitive) && keepDone(s.primitive)) {
        return {
          id: s.id,
          primitive: s.primitive,
          label: s.label,
          state: "done" as const,
          output: s.output,
        };
      }
      return { id: s.id, primitive: s.primitive, label: s.label, state: "pending" as const };
    });

    const newJobId = await ctx.db.insert("jobs", {
      clientId: source.clientId,
      formatId: source.formatId,
      config: source.config,
      status: "running",
      steps,
      costUsd: 0,
      remixedFromJobId: jobId,
    });

    await ctx.runMutation(starter, { jobId: newJobId, clientId: source.clientId });
    return newJobId;
  },
});

/** Auth-free equivalent of influencers.create, for exercising training from the CLI. */
export const seedInfluencerDraft = internalMutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    personaNotes: v.string(),
    trainingImageAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, { clientId, name, personaNotes, trainingImageAssetIds }): Promise<Id<"influencers">> => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return ctx.db.insert("influencers", {
      clientId,
      name,
      personaNotes,
      triggerPhrase: `${slug || "influencer"}${Date.now().toString(36)}`,
      status: "draft",
      trainingImageAssetIds,
    });
  },
});

/** Auth-free equivalent of socialPosts.createDraft, for exercising the composer's path from the CLI. */
export const createSocialDraft = internalMutation({
  args: {
    clientId: v.id("clients"),
    caption: v.string(),
    mediaAssetIds: v.array(v.id("assets")),
    targets: v.array(
      v.object({
        platform: v.string(),
        zernioAccountId: v.string(),
        socialAccountId: v.id("socialAccounts"),
      }),
    ),
  },
  handler: async (ctx, { clientId, caption, mediaAssetIds, targets }): Promise<Id<"socialPosts">> => {
    for (const assetId of mediaAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.clientId !== clientId) throw new Error("Unknown asset.");
    }
    for (const target of targets) {
      const account = await ctx.db.get(target.socialAccountId);
      if (!account || account.clientId !== clientId) throw new Error("Unknown account.");
    }
    return ctx.db.insert("socialPosts", {
      clientId,
      status: "draft",
      caption,
      mediaAssetIds,
      targets: targets.map((t) => ({ ...t, status: "pending" as const })),
    });
  },
});

/**
 * Auth-free equivalent of socialPosts.schedule's dry-run half -- calls
 * Zernio's real pre-flight validate endpoint (no publish, no media
 * processing, no rate-limit spend per its own docs) without the second half
 * that would actually call createPost. For confirming a real multi-item
 * mediaItems body is accepted by the real API before wiring the write path
 * through a CLI-only auth bypass too.
 */
export const validateSocialDraft = internalAction({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }): Promise<zernio.ValidatePostResult> => {
    const loaded: {
      post: {
        caption: string;
        targets: { platform: string; zernioAccountId: string; platformSpecificData?: unknown }[];
      };
      media: { kind: string; url: string | null }[];
    } | null = await ctx.runQuery(internal.socialPosts.getForSchedule, { postId });
    if (!loaded) throw new Error("post not found");
    const { post, media } = loaded;
    if (!media.length) throw new Error("A post needs at least one video or image.");

    const platformSpecificData: Record<string, unknown> = {};
    for (const t of post.targets) {
      if (t.platformSpecificData) platformSpecificData[t.platform] = t.platformSpecificData;
    }
    return zernio.validatePost({
      content: post.caption,
      platforms: post.targets.map((t) => ({ platform: t.platform, accountId: t.zernioAccountId })),
      mediaItems: media.map((m) => ({
        url: m.url as string,
        type: m.kind === "video" ? ("video" as const) : ("image" as const),
      })),
      platformSpecificData: Object.keys(platformSpecificData).length
        ? platformSpecificData
        : undefined,
    });
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
