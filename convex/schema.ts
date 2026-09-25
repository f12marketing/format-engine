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
    /**
     * This client's Zernio profile. Zernio's tenancy is Team -> Profile ->
     * Account, and its docs describe a profile as "one per customer when you
     * build for other people" -- so one profile per client keeps one
     * customer's connected accounts from ever being visible to another.
     * Created lazily on first use rather than at admission, so existing
     * clients don't need backfilling.
     */
    zernioProfileId: v.optional(v.string()),
  }).index("by_auth_user", ["authUserId"]),

  /**
   * Backs the "Mention your business?" toggle on six formats. A brand profile
   * joining the pipeline, not a checkbox -- which is why it is an entity from
   * day one rather than six prompt templates later.
   */
  brands: defineTable({
    clientId: v.id("clients"),
    name: v.string(),
    /** What the business does, in the client's own words -- the line copy is written around. */
    description: v.optional(v.string()),
    /** Who it's for. Steers voice more than any tone label does. */
    audience: v.optional(v.string()),
    website: v.optional(v.string()),
    tone: v.optional(v.string()),
    palette: v.optional(v.array(v.string())),
    logoAssetId: v.optional(v.id("assets")),
    productShotAssetIds: v.optional(v.array(v.id("assets"))),

    // The rest is the sign-up quiz (convex/lib/businessQuiz.ts has the
    // closed answer sets). The business half feeds every "Mention your
    // business" prompt; the "about you" half tells the writer who is posting,
    // which is what makes first-person copy sound like them.
    /** The person, not the company: "posting as". */
    contactName: v.optional(v.string()),
    /** The problem the business solves, in the client's words. */
    problem: v.optional(v.string()),
    /** Why customers pick it. */
    benefits: v.optional(v.string()),
    businessModel: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    role: v.optional(v.string()),
    teamSize: v.optional(v.string()),
    monthlyRevenue: v.optional(v.string()),
    signupIntent: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    heardFrom: v.optional(v.array(v.string())),
    /** The furthest quiz step reached, so a half-finished quiz resumes there. */
    quizStep: v.optional(v.string()),
    /** Set when the quiz is finished; until then the app sends the client to it. */
    onboardedAt: v.optional(v.number()),
    /** "Skip for now": stops the automatic redirect without pretending it was answered. */
    onboardingSkippedAt: v.optional(v.number()),
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
    /**
     * A still extracted from a video, for grids that would otherwise have to
     * load whole MP4s to show a tile. Videos only; the render service already
     * runs ffmpeg, so it produces this rather than a CDN doing it on the fly.
     */
    posterStorageId: v.optional(v.id("_storage")),
  })
    .index("by_client", ["clientId"])
    .index("by_job", ["producedByJobId"])
    // Several rows can share bytes (a stock photo adopted by many clients);
    // retention.ts needs every row pointing at a file before deleting it.
    .index("by_storage", ["storageId"]),

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
    /**
     * Set when retention.ts deleted this job's exported files after their
     * retention period. The job and its deck stay, so the job page can offer
     * to export them again.
     */
    outputsPurgedAt: v.optional(v.number()),
    /**
     * The gallery face each "cast:" roster ref drew for this job, pinned by
     * whichever step resolved it first (see lib/roster.ts). Several steps
     * resolve the same ref -- the voice before the face it has to match --
     * and a re-draw between them would cast a different person mid-video
     * if the gallery changed in the meantime.
     */
    castFaces: v.optional(v.array(v.object({ ref: v.string(), faceId: v.id("galleryFaces") }))),
  })
    .index("by_client", ["clientId"])
    .index("by_client_and_format", ["clientId", "formatId"])
    .index("by_remixed_from", ["remixedFromJobId"])
    .index("by_format_and_purge", ["formatId", "outputsPurgedAt"]),

  /**
   * Written per step, in the same transaction that records the step.
   * `reversalOfId` makes Character Swap's "if it isn't swapped we don't charge
   * you" a first-class entry rather than a manual adjustment.
   */
  spend_ledger: defineTable({
    clientId: v.id("clients"),
    // Optional for spend outside any of the 16 formats' pipelines --
    // influencer training is the first such case. `by_client` still sums
    // every row regardless, which is the one that actually gates the cap.
    jobId: v.optional(v.id("jobs")),
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
   * A trained persona, not a reference photo. `avatars` holds identity as one
   * image; a face composited from it drifts shot to shot. An influencer holds
   * identity as a LoRA trained on 10-50 images, so it stays the same person
   * across arbitrary generated scenes. Never used directly by the 16
   * formats' pipelines -- its only job is to *produce* a reference still,
   * which then feeds the avatar/composite steps that already exist
   * unchanged. A separate table from `avatars` rather than more optional
   * columns on it: a trained persona has a lifecycle (queued, running,
   * failed, retrainable) an avatar row has no concept of.
   */
  influencers: defineTable({
    clientId: v.id("clients"),
    name: v.string(),
    personaNotes: v.string(),
    /** LoRA activation token -- implementation detail, never shown as a concept to the user. */
    triggerPhrase: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("training"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    trainingImageAssetIds: v.array(v.id("assets")),
    /** fal-ai/flux-lora-portrait-trainer's diffusers_lora_file.url, once ready. */
    loraUrl: v.optional(v.string()),
    /** Correlates the training webhook (and the reconciliation cron) back to this row. */
    falRequestId: v.optional(v.string()),
    steps: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    /** Set when the training charge was recorded, so a failed run can reverse the exact row. */
    ledgerId: v.optional(v.id("spend_ledger")),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()), // paired with startedAt -> the one real timing signal fal itself won't give you
    error: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  })
    .index("by_client", ["clientId"])
    .index("by_request", ["falRequestId"]),

  /**
   * P9. Append-only: a client re-rendering last month's ad needs the exact
   * clip it used, and it may be gone upstream. Store the file, never the
   * expiring CDN link.
   */
  /**
   * A social account the client connected through Zernio's OAuth flow.
   *
   * A mirror, not the source of truth -- Zernio owns the tokens and we never
   * see them. `zernioAccountId` is the `_id` from GET /v1/accounts, and is
   * what every publish and analytics call is addressed to. Disconnects are
   * kept as rows (`disconnectedAt`) rather than deleted, so a post that went
   * out through an account still has something to point at afterwards.
   */
  socialAccounts: defineTable({
    clientId: v.id("clients"),
    zernioAccountId: v.string(),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
    ),
    username: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isActive: v.boolean(),
    connectedAt: v.number(),
    lastCheckedAt: v.optional(v.number()),
    disconnectedAt: v.optional(v.number()),
  })
    .index("by_client", ["clientId"])
    .index("by_zernio_account", ["zernioAccountId"]),

  /**
   * One row per composed post, across however many platforms it targets.
   *
   * Zernio is the scheduler -- it holds `scheduledFor`, does the publishing
   * and owns the retries. This table exists so the Library and Calendar can
   * render from one reactive query instead of N API calls, and is reconciled
   * from Zernio's webhooks with a cron backstop (the same arrangement
   * `influencers.reconcileStuckTrainings` already uses for fal).
   *
   * `targets` is per-platform because one post genuinely can half-succeed:
   * Zernio reports `partial` when, say, LinkedIn published and TikTok was
   * rejected, and "which one failed and why" has to survive that.
   */
  socialPosts: defineTable({
    clientId: v.id("clients"),
    /** Absent until the post leaves draft and Zernio assigns its own id. */
    zernioPostId: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("publishing"),
      v.literal("published"),
      v.literal("partial"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    caption: v.string(),
    mediaAssetIds: v.array(v.id("assets")),
    /** Provenance: which generation produced this. Drives Analytics' by-format breakdown. */
    jobId: v.optional(v.id("jobs")),
    scheduledFor: v.optional(v.number()),
    /** IANA zone, sent to Zernio alongside `scheduledFor`, which it interprets in this zone. */
    timezone: v.optional(v.string()),
    targets: v.array(
      v.object({
        platform: v.string(),
        zernioAccountId: v.string(),
        socialAccountId: v.id("socialAccounts"),
        status: v.string(),
        platformPostUrl: v.optional(v.string()),
        error: v.optional(v.string()),
        /** Per-platform fields (tiktokSettings, YouTube title/visibility, ...). */
        platformSpecificData: v.optional(v.any()),
        /**
         * This target's own performance, synced from Zernio's per-post
         * analytics. Living here rather than in a separate table is what lets
         * Analytics attribute by account and by format -- this target already
         * carries `socialAccountId`, and the post already carries `jobId` --
         * without a join that could double-count against `postAnalytics`'s
         * daily rollups.
         */
        analytics: v.optional(
          v.object({
            views: v.number(),
            likes: v.number(),
            comments: v.number(),
            shares: v.number(),
            syncedAt: v.number(),
          }),
        ),
      }),
    ),
    publishedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_client", ["clientId"])
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_client_and_scheduled", ["clientId", "scheduledFor"])
    .index("by_zernio_post", ["zernioPostId"]),

  /**
   * Daily per-platform rollup, cached from GET /v1/analytics/daily-metrics
   * (one call per connected platform, via its `platform` filter -- the
   * endpoint's own per-day figures are already summed across every post, and
   * it has no way to break a single day down by platform in one call).
   *
   * Cached rather than proxied on every page load for two reasons: Zernio's
   * own numbers only refresh on its own schedule, so live calls on every
   * render buy nothing; and keeping rows here means the charts keep working --
   * and keep their history -- regardless of what range Zernio will still
   * serve later. Per-post attribution (by account, by format) deliberately
   * does NOT live here -- see `socialPosts.targets[].analytics` -- so summing
   * this table's rows for a KPI tile can never double-count a post that also
   * has its own per-target numbers.
   */
  postAnalytics: defineTable({
    clientId: v.id("clients"),
    /** "YYYY-MM-DD", as Zernio's own `dailyData[].date` reports it. */
    date: v.string(),
    platform: v.string(),
    /** Distinct posts published this platform this day, per Zernio's own count. */
    postCount: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    impressions: v.number(),
    reach: v.number(),
    syncedAt: v.number(),
  })
    .index("by_client_and_date", ["clientId", "date"])
    .index("by_client_platform_date", ["clientId", "platform", "date"]),

  /**
   * Webhook dedupe. Zernio delivers at least once and retries up to seven
   * times, so the same `X-Zernio-Event-Id` can and will arrive twice; the
   * handler records the id before acting and ignores anything it has seen.
   */
  zernioWebhookEvents: defineTable({
    eventId: v.string(),
    event: v.string(),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  /**
   * The house audio library, shared across every client.
   *
   * Its own table rather than `assets` rows with an optional `clientId`:
   * every read of `assets` is guarded by `asset.clientId !== client._id`, and
   * making that field optional would mean loosening that check everywhere an
   * asset is read -- a security-critical edit in a dozen places to support one
   * picker. `clips` already set this precedent for the same reason: a shared
   * library is not anyone's private asset, so it doesn't live in the private
   * table.
   */
  audioTemplates: defineTable({
    name: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    durationSec: v.optional(v.number()),
    tags: v.array(v.string()),
    /** Retired templates stay readable, so a job that used one still resolves. */
    archived: v.optional(v.boolean()),
    addedAt: v.number(),
    /**
     * Set on a track imported from an outside library the first time any
     * client picks it (so far only "freesound", CC0 only). Kept here rather
     * than per client for the same reason as everything else in this table,
     * and deduped on (source, sourceId). Imported rows stay out of the
     * curated list; they're found through the search that imported them.
     */
    source: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    creator: v.optional(v.string()),
    /** The licence URL exactly as the source reported it at import. */
    license: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  })
    .index("by_added_at", ["addedAt"])
    .index("by_source", ["source", "sourceId"]),

  /**
   * The curated influencer gallery -- ready-made base faces the New
   * Influencer popup's "Pick from gallery" tab picks from, instead of
   * generating or uploading one. Same reasoning as `audioTemplates`: a stock
   * reference photo isn't anyone's private asset, so it doesn't live in the
   * private `assets` table. Picking one copies it into the client's own
   * `assets` (see `galleryFaces.useFace`) so it becomes usable anywhere an
   * owned asset is required, the same way a job never re-uploads a shared
   * clip or audio template either.
   */
  galleryFaces: defineTable({
    storageId: v.id("_storage"),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** Retired faces stay readable, so an influencer that used one still resolves. */
    archived: v.optional(v.boolean()),
    addedAt: v.number(),
    /**
     * Which casting pool the face belongs to: "A woman" / "A man" in the
     * person picker draws from these. Curated by hand (`galleryFaces.label`);
     * an unlabelled face is only ever cast for "Anyone".
     */
    gender: v.optional(v.union(v.literal("woman"), v.literal("man"))),
    /** A short caption for the picker tile, e.g. "Warm, 30s". */
    label: v.optional(v.string()),
  }).index("by_added_at", ["addedAt"]),

  /**
   * App-wide reference images generated once and reused by every client --
   * Skeleton's default character, so far. Keyed rather than listed: a new
   * version of an image gets a new key, and old jobs' outputs are unaffected
   * because they stored their own copies.
   */
  houseImages: defineTable({
    key: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    addedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Image Slideshow's stock photo sets (lib/imageSets.ts), seeded from Pexels
   * and Pixabay by `imageSets.seed`. Shared, like `galleryFaces`, and used the
   * same way: a picked photo is copied into the client's own `assets`
   * pointing at the same bytes, so every deck, owner check and export treats
   * it like any other image of theirs. The bytes are stored rather than
   * hotlinked because Pixabay's terms forbid hotlinking.
   */
  stockImages: defineTable({
    set: v.string(),
    source: v.union(v.literal("pexels"), v.literal("pixabay")),
    sourceId: v.string(),
    storageId: v.id("_storage"),
    /**
     * A ~360px copy for the popup's grids, which would otherwise download
     * every full-size photo just to draw a tile. Optional: rows seeded before
     * it existed get one from `imageSets.backfillThumbs`.
     */
    thumbStorageId: v.optional(v.id("_storage")),
    mimeType: v.string(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    /** Pexels' alt text or Pixabay's tags -- what the writer matches slides to. */
    description: v.string(),
    photographer: v.optional(v.string()),
    /** The photo's page on its source, for attribution. */
    pageUrl: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    addedAt: v.number(),
    /**
     * A searched photo that retention.ts found in use: never checked, and so
     * never deleted, again. Unset on image-set photos, which are never deleted.
     */
    keptAt: v.optional(v.number()),
  })
    .index("by_set", ["set"])
    .index("by_source", ["source", "sourceId"])
    .index("by_set_and_kept", ["set", "keptAt"]),

  /**
   * The Images popup's photo search, cached for 24 hours per query and page
   * -- Pixabay's API terms require it, and it keeps a popular search from
   * spending the hourly quota twice. A stale row is simply overwritten.
   */
  stockSearches: defineTable({
    key: v.string(),
    results: v.any(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

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
