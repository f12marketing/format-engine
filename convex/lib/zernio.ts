/**
 * The Zernio client -- one API across TikTok, Instagram, YouTube and LinkedIn.
 *
 * Plain `fetch` in the V8 runtime, same as lib/fal.ts: none of these calls
 * need Node APIs, and a `"use node"` file may contain only actions, which
 * would force every caller into an action for no reason.
 *
 * Unlike fal, nothing here polls. Zernio is itself the scheduler -- a post is
 * handed over with a `scheduledFor` and Zernio owns the publishing and the
 * retries from then on -- so the long-running work never lives inside a
 * Convex action, and the results come back over a webhook instead.
 *
 * Auth is standard Bearer, not fal's `Key` scheme.
 */

const BASE = "https://zernio.com/api/v1";

export type ZernioPlatform = "tiktok" | "instagram" | "youtube" | "linkedin";

/** The four this app supports. Zernio itself speaks many more. */
export const SUPPORTED_PLATFORMS: ZernioPlatform[] = [
  "tiktok",
  "instagram",
  "youtube",
  "linkedin",
];

function key(): string {
  const k = (process.env.ZERNIO_API_KEY ?? "").trim();
  if (!k) {
    throw new Error(
      "ZERNIO_API_KEY is not set on the Convex deployment. " +
        "Run: npx convex env set ZERNIO_API_KEY <your key>",
    );
  }
  return k;
}

/** Whether social features can work at all, for UI that shouldn't offer them otherwise. */
export function zernioConfigured(): boolean {
  return (process.env.ZERNIO_API_KEY ?? "").trim().length > 0;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" };
}

/**
 * Carries the HTTP status so callers can branch on it -- 402 specifically
 * means "Analytics add-on required" on every analytics endpoint, which is a
 * plan limitation to show plainly rather than a bug to report as one.
 */
export class ZernioApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

async function zernioFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: authHeaders(),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  if (!res.ok) {
    // Surface Zernio's own message rather than a bare status: its 4xx bodies
    // name the offending field (a caption over a platform's limit, a missing
    // tiktokSettings key), which is the only useful thing to show the user.
    throw new ZernioApiError(
      res.status,
      `Zernio ${init?.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ------------------------------------------------------------------ profiles

export async function createProfile(name: string): Promise<string> {
  const out = await zernioFetch<{ profile: { _id: string } }>("/profiles", {
    method: "POST",
    body: { name },
  });
  return out.profile._id;
}

// ------------------------------------------------------------------ accounts

/**
 * The OAuth handoff. Returns the URL to send the user's browser to.
 *
 * `redirect_url` is a per-request query param, not a fixed dashboard
 * setting -- confirmed against Zernio's raw OpenAPI reference after this
 * file's first version, written against a summary, assumed the latter and
 * never sent it. Without it Zernio has nowhere to bounce the browser back
 * to once the platform finishes: the account still connects on Zernio's
 * side, but the user is left stranded on whatever Zernio shows instead of
 * returning to this app. On success Zernio appends
 * `?connected=&profileId=&accountId=&username=`; on failure `?error=&platform=`.
 */
export async function connectUrl(
  platform: ZernioPlatform,
  profileId: string,
  redirectUrl: string,
): Promise<string> {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const out = await zernioFetch<{ authUrl: string }>(`/connect/${platform}?${qs.toString()}`);
  return out.authUrl;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  isActive: boolean;
  displayName?: string;
  avatarUrl?: string;
  profileId?: string;
}

export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const out = await zernioFetch<{ accounts: ZernioAccount[] }>(`/accounts${qs}`);
  return out.accounts ?? [];
}

export async function disconnectAccount(accountId: string): Promise<void> {
  await zernioFetch(`/accounts/${accountId}`, { method: "DELETE" });
}

// --------------------------------------------------------------------- posts

export interface ZernioMediaItem {
  url: string;
  type: "video" | "image";
}

export interface ZernioTarget {
  platform: string;
  accountId: string;
}

export interface CreatePostInput {
  content: string;
  platforms: ZernioTarget[];
  mediaItems?: ZernioMediaItem[];
  /** Omit to publish immediately. Interpreted in `timezone`. */
  scheduledFor?: string;
  timezone?: string;
  isDraft?: boolean;
  /** Keyed by platform, e.g. `{ tiktok: {...}, youtube: {...} }`. */
  platformSpecificData?: Record<string, unknown>;
}

export interface ZernioPost {
  _id: string;
  status: string;
  scheduledFor?: string;
  platforms?: {
    platform: string;
    status: string;
    postUrl?: string;
    error?: string;
  }[];
}

export async function createPost(input: CreatePostInput): Promise<ZernioPost> {
  const out = await zernioFetch<{ post: ZernioPost }>("/posts", {
    method: "POST",
    body: input,
  });
  return out.post;
}

export async function getPost(postId: string): Promise<ZernioPost> {
  const out = await zernioFetch<{ post: ZernioPost }>(`/posts/${postId}`);
  return out.post;
}

export async function updatePost(
  postId: string,
  patch: Partial<CreatePostInput>,
): Promise<ZernioPost> {
  const out = await zernioFetch<{ post: ZernioPost }>(`/posts/${postId}`, {
    method: "PATCH",
    body: patch,
  });
  return out.post;
}

export async function cancelPost(postId: string): Promise<void> {
  await zernioFetch(`/posts/${postId}`, { method: "DELETE" });
}

// ------------------------------------------------------------- pre-flight
//
// Not `/v1/validate` -- that path doesn't exist. Confirmed against Zernio's
// raw OpenAPI reference (docs.zernio.com/llms-full.txt) after the analytics
// endpoints turned out wrong the same way earlier: this app's own plan had
// written down a summary rather than the real path. The real one dry-runs
// the exact publish pipeline `POST /v1/posts` uses -- same body, no
// publishing, no media processing, no rate-limit spend -- and catches things
// the local checks in src/lib/socialPlatforms.ts can't: hashtag limits,
// thread formats, Facebook Reel requirements, and the rest of what only
// Zernio's own pipeline actually enforces.

export type ValidatePostResult =
  | { valid: true; message?: string; warnings?: { platform: string; warning: string }[] }
  | {
      valid: false;
      errors: { platform: string; error: string }[];
      warnings?: { platform: string; warning: string }[];
    };

export async function validatePost(input: CreatePostInput): Promise<ValidatePostResult> {
  return zernioFetch("/tools/validate/post", { method: "POST", body: input });
}

// ----------------------------------------------------------------- analytics
//
// Two different endpoints for two different jobs -- confirmed against
// Zernio's own OpenAPI reference (docs.zernio.com/llms-full.txt), not the
// looser prose summary this file was first written against. That summary
// described a single `/v1/analytics?granularity=day` time series; the real
// endpoint returns a *per-post* list instead, and the actual time series
// lives at `/v1/analytics/daily-metrics`. Both require Zernio's Analytics
// add-on (a 402 `ZernioApiError` on legacy plans without it) -- callers
// should catch that specifically rather than let it read as a bug.

export interface DailyMetricPoint {
  date: string;
  postCount: number;
  platforms: Record<string, number>;
  metrics: {
    impressions: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    clicks: number;
    views: number;
  };
}

export interface PlatformBreakdownEntry {
  platform: string;
  postCount: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
}

/**
 * The time-series source: `GET /v1/analytics/daily-metrics`. One row per day,
 * already summed across every post published that day, plus a per-platform
 * breakdown totalled over the whole range (not per day -- Zernio doesn't
 * offer that combination, so a per-platform *daily* series means calling this
 * once per platform via the `platform` filter instead of once unfiltered).
 */
export async function getDailyMetrics(params: {
  fromDate: string;
  toDate: string;
  platform?: string;
  accountId?: string;
  profileId?: string;
  source?: "late" | "external" | "all";
  attribution?: "publish" | "received";
}): Promise<{ dailyData: DailyMetricPoint[]; platformBreakdown: PlatformBreakdownEntry[] }> {
  const qs = new URLSearchParams({ fromDate: params.fromDate, toDate: params.toDate });
  if (params.platform) qs.set("platform", params.platform);
  if (params.accountId) qs.set("accountId", params.accountId);
  if (params.profileId) qs.set("profileId", params.profileId);
  if (params.source) qs.set("source", params.source);
  if (params.attribution) qs.set("attribution", params.attribution);
  return zernioFetch(`/analytics/daily-metrics?${qs.toString()}`);
}

export interface PostAnalyticsMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  lastUpdated: string;
}

export interface PlatformAnalyticsEntry {
  platform: string;
  status: string;
  accountId: string;
  analytics: PostAnalyticsMetrics;
  syncStatus: string;
}

export interface PostAnalyticsEntry {
  postId: string;
  status: string;
  publishedAt: string | null;
  analytics: PostAnalyticsMetrics;
  platformAnalytics: PlatformAnalyticsEntry[];
}

/**
 * The per-post source: `GET /v1/analytics` (no `postId`, so the paginated
 * list rather than a single lookup). This is what lets a post's own numbers
 * be attributed back to *our* data -- the format it came from, the account it
 * went out through -- since Zernio has no idea what a "format" is.
 * `source: "late"` by default: only posts scheduled through Zernio, which is
 * every post this app's `socialPosts` table knows about.
 */
export async function listPostAnalytics(params: {
  fromDate: string;
  toDate: string;
  profileId?: string;
  platform?: string;
  source?: "late" | "external" | "all";
  limit?: number;
  page?: number;
}): Promise<{
  posts: PostAnalyticsEntry[];
  pagination?: { page: number; limit: number; total?: number };
}> {
  const qs = new URLSearchParams({
    fromDate: params.fromDate,
    toDate: params.toDate,
    source: params.source ?? "late",
    limit: String(params.limit ?? 100),
    page: String(params.page ?? 1),
  });
  if (params.profileId) qs.set("profileId", params.profileId);
  if (params.platform) qs.set("platform", params.platform);
  return zernioFetch(`/analytics?${qs.toString()}`);
}
