import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The plan's data model, one table at a time.
 *
 * Two rules that shape almost every decision here:
 *  - a job stores a *copy* of its config, never a reference, so re-running a
 *    six-week-old job doesn't silently pick up an edited brand or avatar;
 *  - every paid step writes a ledger row in the same transaction that records
 *    the step, so "what does this client cost me" is a query rather than an
 *    audit.
 */
export default defineSchema({
  /** Invite-only. The cap is the runaway guard, not a billing construct. */
  clients: defineTable({
    authUserId: v.string(), // Supabase auth.users.id (the JWT's `sub` claim)
    displayName: v.string(),
    monthlySpendCapUsd: v.number(),
    archived: v.optional(v.boolean()),
  }).index("by_auth_user", ["authUserId"]),

  /**
   * Backs the "Mention your business?" toggle on six formats. A brand profile
   * joining the pipeline, not a checkbox -- which is why it is an entity from
   * day one rather than six prompt templates later.
   */
  brands: defineTable({
    clientId: v.id("clients"),
    name: v.string(),
    tone: v.optional(v.string()),
    palette: v.optional(v.array(v.string())),
    logoAssetId: v.optional(v.id("assets")),
    productShotAssetIds: v.optional(v.array(v.id("assets"))),
  }).index("by_client", ["clientId"]),

  /**
   * P10. Four formats ask for an influencer by name ("Who's cutting",
   * "Avatar", "Presenter"); they mean the same stored character. Identity has
   * to survive across runs or the same presenter arrives as a different person
   * in every render -- hence stored reference images rather than a prompt.
   */
  avatars: defineTable({
    clientId: v.optional(v.id("clients")), // null = shared house roster
    name: v.string(),
    lookNotes: v.string(),
    referenceAssetIds: v.array(v.id("assets")),
    archived: v.optional(v.boolean()),
  }).index("by_client", ["clientId"]),

  /** Uploads and outputs alike: demo videos, product images, finished renders. */
  assets: defineTable({
    clientId: v.id("clients"),
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("pdf"),
      v.literal("text"),
    ),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    /** Set when this asset was produced by a job rather than uploaded. */
    producedByJobId: v.optional(v.id("jobs")),
  })
    .index("by_client", ["clientId"])
    .index("by_job", ["producedByJobId"]),

  /**
   * One row per run, for every format. `config` is a snapshot, `steps` is the
   * workflow's own persisted progress -- which is what the preview panel
   * subscribes to, so there is no polling code in the frontend.
   */
  jobs: defineTable({
    clientId: v.id("clients"),
    formatId: v.string(),
    /** Frozen copy of the config panel's values at submit time. */
    config: v.any(),
    status: v.union(
      v.literal("draft"),
      v.literal("running"),
      v.literal("awaiting_approval"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    steps: v.array(
      v.object({
        id: v.string(),
        primitive: v.string(),
        /** Human label, copied from the format declaration at job creation so
         *  the job stays readable even if the format's wording later changes. */
        label: v.string(),
        state: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("awaiting_approval"),
          v.literal("done"),
          v.literal("failed"),
          v.literal("skipped"),
        ),
        startedAt: v.optional(v.number()),
        endedAt: v.optional(v.number()),
        error: v.optional(v.string()),
        /** Whatever this step produced -- an asset id, a deck, a URL. */
        output: v.optional(v.any()),
      }),
    ),
    outputAssetIds: v.optional(v.array(v.id("assets"))),
    /** Running total in USD, summed from spend_ledger as steps complete. */
    costUsd: v.number(),
    /** Set when this job was created by Remix or Regenerate copy. */
    remixedFromJobId: v.optional(v.id("jobs")),
    workflowId: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index("by_client", ["clientId"])
    .index("by_client_and_format", ["clientId", "formatId"])
    .index("by_remixed_from", ["remixedFromJobId"]),

  /**
   * Written per step, in the same transaction that records the step.
   * `reversalOfId` makes Character Swap's "if it isn't swapped we don't charge
   * you" a first-class entry rather than a manual adjustment.
   */
  spend_ledger: defineTable({
    clientId: v.id("clients"),
    jobId: v.id("jobs"),
    stepId: v.string(),
    primitive: v.string(),
    model: v.string(),
    units: v.number(),
    unitLabel: v.string(),
    costUsd: v.number(),
    reversalOfId: v.optional(v.id("spend_ledger")),
  })
    .index("by_client", ["clientId"])
    .index("by_job", ["jobId"]),

  /**
   * P9. Append-only: a client re-rendering last month's ad needs the exact
   * clip it used, and it may be gone upstream. Store the file, never the
   * expiring CDN link.
   */
  clips: defineTable({
    source: v.string(), // "tiktok" | "instagram" | ...
    sourceUrl: v.string(),
    creatorHandle: v.optional(v.string()),
    storageId: v.id("_storage"),
    durationSec: v.number(),
    width: v.number(),
    height: v.number(),
    hasMusic: v.optional(v.boolean()),
    tags: v.array(v.string()),
    ingestedAt: v.number(),
  })
    .index("by_source_url", ["sourceUrl"])
    .index("by_ingested_at", ["ingestedAt"]),
});
