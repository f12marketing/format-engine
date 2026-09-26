import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { submitWithWebhook, submitWithContentPolicyFallback } from "./lib/fal";
import { referencePortraitPrompt, REFERENCE_PORTRAIT_FALLBACK } from "./lib/facePrompt";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { enforceRateLimit } from "./lib/rateLimit";
import { assertLikenessConsent } from "./lib/likeness";

/**
 * Trained personas -- see schema.ts's own comment on the `influencers` table
 * for why this is a separate table from `avatars`. This file owns the whole
 * lifecycle: assemble a training set (generated, uploaded, or pulled from the
 * P10 avatar roster -- see NewInfluencerModal.tsx for the popup), create a
 * draft, kick off training (fal-ai/flux-lora-portrait-trainer, confirmed
 * paired with fal-ai/flux-lora for generation via a real live test on 8 Sep
 * 2026), and settle it via webhook or the reconciliation cron when fal can't
 * reach back (every local dev deployment, since CONVEX_SITE_URL resolves to a
 * 127.0.0.1 address fal's servers cannot call).
 */

const TRAINER_MODEL = "fal-ai/flux-lora-portrait-trainer";
const PRICE_PER_STEP = 0.0024;
const MIN_BILLED_STEPS = 1000;
const MIN_TRAINING_IMAGES = 10;
/** The trainer's own default, and this app's "Standard" tier. */
const DEFAULT_STEPS = 2500;
/** Past this, a training that never got a webhook is treated as abandoned rather than merely slow. */
const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;
/** What one generated training-set photo costs -- shared by the action and the popup's `config` query. */
const FACE_IMAGE_COST_USD = 0.05;

function trainingCostUsd(steps: number): number {
  return Math.max(MIN_BILLED_STEPS, steps) * PRICE_PER_STEP;
}

/** A LoRA activation token, not a user-facing concept -- derived so nobody has to invent one. */
function triggerPhraseFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${slug || "influencer"}${Date.now().toString(36)}`;
}

export const create = mutation({
  args: {
    name: v.string(),
    personaNotes: v.string(),
    trainingImageAssetIds: v.array(v.id("assets")),
  },
  handler: async (ctx, { name, personaNotes, trainingImageAssetIds }): Promise<Id<"influencers">> => {
    const client = await requireClient(ctx);
    if (trainingImageAssetIds.length < MIN_TRAINING_IMAGES) {
      throw new Error(`At least ${MIN_TRAINING_IMAGES} training images are required.`);
    }
    // Training on a real person's photos makes an AI double of them: only
    // with their permission (lib/likeness.ts). Generated faces are exempt.
    await assertLikenessConsent(ctx, client._id, trainingImageAssetIds);
    return ctx.db.insert("influencers", {
      clientId: client._id,
      name,
      personaNotes,
      triggerPhrase: triggerPhraseFor(name),
      status: "draft",
      trainingImageAssetIds,
    });
  },
});

async function resolveFirstImage(
  ctx: QueryCtx,
  trainingImageAssetIds: Id<"assets">[],
): Promise<string | null> {
  const first = trainingImageAssetIds[0];
  if (!first) return null;
  const asset = await ctx.db.get(first);
  if (!asset) return null;
  return ctx.storage.getUrl(asset.storageId);
}

/** `imageUrl` is additive -- the roster picker's thumbnail, resolved the same way `avatars.list` does. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const rows = await ctx.db
      .query("influencers")
      .withIndex("by_client", (q) => q.eq("clientId", client._id))
      .collect();
    const visible = rows.filter((r) => !r.archived);
    return Promise.all(
      visible.map(async (r) => ({
        ...r,
        imageUrl: await resolveFirstImage(ctx, r.trainingImageAssetIds),
      })),
    );
  },
});

/** Live arithmetic for the popup as the user drags a step-count slider -- no auth needed, nothing is spent yet. */
export const estimateCost = query({
  args: { steps: v.number() },
  handler: async (_ctx, { steps }) => trainingCostUsd(steps),
});

/**
 * Rough, clearly-labelled wall-clock estimate for the popup -- not fal's own
 * number (they don't expose one), derived from the one real measurement this
 * app has: ~5 minutes for the cheapest 1000-step tier, scaled linearly.
 */
function estimatedTrainingMinutes(steps: number): number {
  return Math.ceil((Math.max(MIN_BILLED_STEPS, steps) / 1000) * 5);
}

/** The popup's fixed knobs, so the frontend never hardcodes a number that could drift from the backend's. */
export const config = query({
  args: {},
  handler: async () => ({
    minTrainingImages: MIN_TRAINING_IMAGES,
    defaultSteps: DEFAULT_STEPS,
    defaultCostUsd: trainingCostUsd(DEFAULT_STEPS),
    estimatedMinutes: estimatedTrainingMinutes(DEFAULT_STEPS),
    faceImageCostUsd: FACE_IMAGE_COST_USD,
  }),
});

/**
 * One training-set photo, generated rather than sourced -- the same
 * cold-start problem `avatars.generate` solves for P10, reused here so
 * building a training set doesn't require the client to already own 10+
 * real photos of a persona that doesn't exist yet. Public entry point
 * mirrors `avatars.generate`'s auth-resolution shape exactly.
 */
export const generateFaceImage = action({
  args: { personaNotes: v.string() },
  handler: async (ctx, { personaNotes }): Promise<Id<"assets">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");
    await enforceRateLimit(ctx, "generateFaceImage", client._id);
    return ctx.runAction(internal.influencers.generateFaceImageForClient, {
      clientId: client._id,
      personaNotes,
    });
  },
});

export const generateFaceImageForClient = internalAction({
  args: { clientId: v.id("clients"), personaNotes: v.string() },
  handler: async (ctx, { clientId, personaNotes }): Promise<Id<"assets">> => {
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: FACE_IMAGE_COST_USD,
    });

    const buildInput = (prompt: string) => ({ prompt, aspect_ratio: "3:4", num_images: 1 });
    const result = (await submitWithContentPolicyFallback(
      "fal-ai/nano-banana-2",
      buildInput,
      referencePortraitPrompt(personaNotes),
      () => REFERENCE_PORTRAIT_FALLBACK,
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no face image returned");

    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch generated face: ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));

    // Not recorded in spend_ledger, same as avatars.generateForClient: no job
    // exists to attach the row to at this point in the flow. assertUnderCap
    // above still stops a runaway sequence of these.
    return ctx.runMutation(internal.assets.record, {
      clientId,
      storageId,
      mimeType: "image/png",
      bytes: bytes.byteLength,
      synthetic: true,
    });
  },
});

export const getInternal = internalQuery({
  args: { influencerId: v.id("influencers") },
  handler: async (ctx, { influencerId }) => ctx.db.get(influencerId),
});

/** The webhook receiver's and the reconciliation cron's shared lookup. */
export const getByRequestId = internalQuery({
  args: { falRequestId: v.string() },
  handler: async (ctx, { falRequestId }) =>
    ctx.db
      .query("influencers")
      .withIndex("by_request", (q) => q.eq("falRequestId", falRequestId))
      .unique(),
});

export const listStuckTraining = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"influencers">[]> => {
    const training = await ctx.db
      .query("influencers")
      .filter((q) => q.eq(q.field("status"), "training"))
      .collect();
    const cutoff = Date.now() - STUCK_AFTER_MS;
    return training.filter((r) => (r.startedAt ?? 0) < cutoff);
  },
});

/** Public entry point: resolves identity, then hands off to the action that actually spends money. */
export const startTraining = action({
  args: { influencerId: v.id("influencers"), steps: v.optional(v.number()) },
  handler: async (ctx, { influencerId, steps }): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authorized. This is an invite-only tool.");
    const client = await ctx.runQuery(internal.clients.getByAuthUserId, {
      authUserId: identity.subject,
    });
    if (!client) throw new Error("Not authorized. This is an invite-only tool.");
    return ctx.runAction(internal.influencers.startTrainingForClient, {
      influencerId,
      clientId: client._id,
      steps: steps ?? DEFAULT_STEPS,
    });
  },
});

async function resolveAssetUrl(ctx: ActionCtx, assetId: Id<"assets">): Promise<string> {
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset) throw new Error("A training image could not be found.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("Could not read a training image.");
  return url;
}

export const startTrainingForClient = internalAction({
  args: { influencerId: v.id("influencers"), clientId: v.id("clients"), steps: v.number() },
  handler: async (ctx, { influencerId, clientId, steps }): Promise<null> => {
    const influencer = await ctx.runQuery(internal.influencers.getInternal, { influencerId });
    if (!influencer) throw new Error("Influencer not found.");
    if (influencer.clientId !== clientId) throw new Error("Not authorized for this influencer.");
    if (influencer.status === "training") throw new Error("This influencer is already training.");
    if (influencer.trainingImageAssetIds.length < MIN_TRAINING_IMAGES) {
      throw new Error(`At least ${MIN_TRAINING_IMAGES} training images are required.`);
    }

    const clampedSteps = Math.max(1, Math.min(10000, Math.round(steps)));
    const costUsd = trainingCostUsd(clampedSteps);
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd });

    const imageUrls = await Promise.all(
      influencer.trainingImageAssetIds.map((id) => resolveAssetUrl(ctx, id)),
    );

    const base = renderServiceBase();
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const packRes = await fetch(`${base}/pack/images`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({ imageUrls, uploadUrl }),
    });
    if (!packRes.ok) {
      throw new Error(`could not pack training images: ${packRes.status} ${await packRes.text()}`);
    }
    const { storageId } = (await packRes.json()) as { storageId: Id<"_storage"> };
    const zipUrl = await ctx.storage.getUrl(storageId);
    if (!zipUrl) throw new Error("could not read back the packed training zip");

    const siteUrl = (process.env.CONVEX_SITE_URL ?? "").trim();
    if (!siteUrl) throw new Error("CONVEX_SITE_URL is not available on this deployment.");
    // Locally this resolves to a 127.0.0.1 address fal's servers cannot call
    // back -- the same environment limitation every other fal-calls-us-back
    // path in this app already has. The reconciliation cron, not the
    // webhook, is what actually completes a local training run; the webhook
    // is the fast path once this is deployed for real.
    const webhookUrl = `${siteUrl}/fal/training-complete`;

    const { requestId } = await submitWithWebhook(
      TRAINER_MODEL,
      { images_data_url: zipUrl, steps: clampedSteps, trigger_phrase: influencer.triggerPhrase },
      webhookUrl,
    );

    // Charged now, not on completion: fal bills the compute whether or not
    // training succeeds, so submission is the moment money is genuinely
    // committed. A failed run reverses this exact row (see
    // handleTrainingWebhook / reconcileStuckTrainings below) rather than
    // this app pretending the charge never happened.
    const ledgerId = await ctx.runMutation(internal.ledger.record, {
      clientId,
      stepId: "train",
      primitive: "TRAIN",
      model: TRAINER_MODEL,
      units: clampedSteps,
      unitLabel: "steps",
      costUsd,
    });

    await ctx.runMutation(internal.influencers.patchStatus, {
      influencerId,
      status: "training",
      falRequestId: requestId,
      steps: clampedSteps,
      costUsd,
      ledgerId,
      startedAt: Date.now(),
    });
    return null;
  },
});

export const patchStatus = internalMutation({
  args: {
    influencerId: v.id("influencers"),
    status: v.union(
      v.literal("draft"),
      v.literal("training"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    falRequestId: v.optional(v.string()),
    steps: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    ledgerId: v.optional(v.id("spend_ledger")),
    loraUrl: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { influencerId, ...patch }) => {
    await ctx.db.patch(influencerId, patch);
  },
});

interface TrainingResultPayload {
  diffusers_lora_file?: { url?: string };
}

/**
 * Shared by the webhook receiver and the reconciliation cron -- both settle
 * a training the same way, they just find out about it differently.
 * Idempotent on status: a row already `ready` or `failed` is left alone, so
 * fal's own webhook retries (up to 31, with backoff) and a cron sweep racing
 * a late webhook can never double-apply or double-reverse.
 */
export const handleTrainingWebhook = internalMutation({
  args: {
    falRequestId: v.string(),
    status: v.union(v.literal("OK"), v.literal("ERROR")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { falRequestId, status, result, error }): Promise<null> => {
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_request", (q) => q.eq("falRequestId", falRequestId))
      .unique();
    // Unknown or already-settled request id -- a stale retry, a webhook for
    // a request this deployment never made, or one already reconciled by the
    // cron. Silently fine either way.
    if (!influencer || influencer.status !== "training") return null;

    if (status === "OK") {
      const loraUrl = (result as TrainingResultPayload | undefined)?.diffusers_lora_file?.url;
      if (!loraUrl) {
        await ctx.db.patch(influencer._id, {
          status: "failed",
          error: "Training completed but returned no LoRA file.",
          finishedAt: Date.now(),
        });
        if (influencer.ledgerId) {
          await ctx.runMutation(internal.ledger.reverse, {
            ledgerId: influencer.ledgerId,
            reason: "training completed with no usable output",
          });
        }
        return null;
      }
      await ctx.db.patch(influencer._id, { status: "ready", loraUrl, finishedAt: Date.now() });
      return null;
    }

    // status === "ERROR" -- fal already ran (and billed for) the compute,
    // so per this app's own "if it didn't work, don't charge for it" rule
    // (Character Swap's own precedent), the charge is reversed here rather
    // than left to stand for a training that produced nothing.
    await ctx.db.patch(influencer._id, {
      status: "failed",
      error: error ?? "Training failed.",
      finishedAt: Date.now(),
    });
    if (influencer.ledgerId) {
      await ctx.runMutation(internal.ledger.reverse, {
        ledgerId: influencer.ledgerId,
        reason: "training failed",
      });
    }
    return null;
  },
});

/**
 * The webhook's backstop. Local dev never receives the webhook at all
 * (CONVEX_SITE_URL is a 127.0.0.1 address there), and even in production a
 * delivery can be lost -- a persona stuck "training" forever is a support
 * ticket, not just an inconvenience. Runs on a schedule (see crons.ts),
 * polling fal's own queue status for anything that's been "training" for
 * over three hours and settling it exactly like the webhook would.
 */
export const reconcileStuckTrainings = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const stuck = await ctx.runQuery(internal.influencers.listStuckTraining, {});
    for (const influencer of stuck) {
      if (!influencer.falRequestId) continue;
      try {
        const statusRes = await fetch(
          `https://queue.fal.run/${TRAINER_MODEL}/requests/${influencer.falRequestId}/status`,
          { headers: { Authorization: `Key ${(process.env.FAL_API_KEY ?? "").trim()}` } },
        );
        if (!statusRes.ok) continue;
        const { status } = (await statusRes.json()) as { status: string };

        if (status === "COMPLETED") {
          const resultRes = await fetch(
            `https://queue.fal.run/${TRAINER_MODEL}/requests/${influencer.falRequestId}`,
            { headers: { Authorization: `Key ${(process.env.FAL_API_KEY ?? "").trim()}` } },
          );
          const result = resultRes.ok ? await resultRes.json() : undefined;
          await ctx.runMutation(internal.influencers.handleTrainingWebhook, {
            falRequestId: influencer.falRequestId,
            status: "OK",
            result,
          });
        } else if (status === "FAILED") {
          await ctx.runMutation(internal.influencers.handleTrainingWebhook, {
            falRequestId: influencer.falRequestId,
            status: "ERROR",
            error: "fal reported the training job failed.",
          });
        }
        // IN_QUEUE / IN_PROGRESS past the stuck threshold: leave it:
        // genuinely still running is possible, and the next sweep re-checks.
      } catch {
        // One influencer's reconciliation failing (a transient fetch error)
        // shouldn't stop the sweep from checking the rest.
      }
    }
    return null;
  },
});
