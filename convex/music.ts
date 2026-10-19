import { v } from "convex/values";
import { action, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentClient, requireClientForAction } from "./clients";
import { enforceRateLimit } from "./lib/rateLimit";
import { MOODS } from "./lib/musicMoods";

/**
 * Background music for the audio popup's Platform tab, from Freesound.
 *
 * Why Freesound: neither Pexels nor Pixabay exposes audio through its API
 * (both are photos and videos only), and this music ends up inside clients'
 * ads -- so the source has to be one whose licence allows commercial use
 * with no strings. Every search and every import is restricted to CC0
 * (public domain), and the import re-checks the licence itself rather than
 * trusting what the browser says it picked.
 *
 * Needs FREESOUND_API_KEY on the deployment (free, from
 * https://freesound.org/apiv2/apply). Without it the search reports
 * `configured: false` and the popup says so.
 */

const API = "https://freesound.org/apiv2";
const CC0 = "publicdomain/zero";
const FIELDS = "id,name,username,duration,previews,tags,license";

export interface PlatformTrack {
  id: string;
  name: string;
  creator: string;
  durationSec: number;
  previewUrl: string;
  tags: string[];
}

interface FreesoundSound {
  id: number;
  name: string;
  username: string;
  duration: number;
  license: string;
  tags?: string[];
  previews?: Record<string, string>;
}

function apiKey(): string | null {
  return (process.env.FREESOUND_API_KEY ?? "").trim() || null;
}

async function requireCaller(ctx: ActionCtx): Promise<Id<"clients">> {
  const client = await requireClientForAction(ctx);
  return client._id;
}

/**
 * A Freesound API call, retried. Failures seen in production were dropped
 * connections ~11s in, not the timeout -- transient, and gone on the next
 * try -- so quiet retries spare the user a "try again" they'd only have to
 * click. The real cause is logged, since the message shown can't carry it.
 *
 * Each retry waits first (1s, then 2s): a failed DNS lookup fails instantly,
 * and back-to-back attempts land inside the same blip -- seen on 25 Sept
 * 2026, both attempts failing within one second. A slow failure has already
 * cost its 15s, though, so no retry starts past 20s in: a search box stuck
 * for 45s is worse than one that says try again.
 */
const RETRY_DELAYS_MS = [1_000, 2_000];
const RETRY_BUDGET_MS = 20_000;

async function freesoundFetch(url: string): Promise<Response> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status < 500) return res;
      // A 5xx is Freesound having a moment, same as a dropped connection.
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    console.warn(`freesound attempt ${attempt + 1} failed:`, lastError instanceof Error ? lastError.message : lastError);

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || Date.now() - started + delay > RETRY_BUDGET_MS) {
      // Out of tries: a 5xx goes back to the caller, which reports its status.
      if (res) return res;
      break;
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  // AbortSignal.timeout rejects with a DOMException, which isn't always an Error.
  const timedOut = (lastError as { name?: string } | undefined)?.name === "TimeoutError";
  throw new Error(
    timedOut
      ? "The music library is slow to answer right now. Try again in a moment."
      : "Couldn't reach the music library right now. Try again in a moment.",
  );
}

/** A readable title from a file name: "happy_ukulele-loop_120bpm.wav" -> "Happy ukulele loop 120bpm". */
function title(name: string): string {
  const t = name.replace(/\.(wav|mp3|flac|ogg|aiff?|m4a)$/i, "").replace(/[_-]+/g, " ").trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80) || "Untitled";
}

function toTrack(s: FreesoundSound): PlatformTrack | null {
  const previewUrl = s.previews?.["preview-hq-mp3"] ?? s.previews?.["preview-lq-mp3"];
  if (!previewUrl || !s.license.includes(CC0)) return null;
  return {
    id: String(s.id),
    name: title(s.name),
    creator: s.username,
    durationSec: Math.round(s.duration),
    previewUrl,
    tags: (s.tags ?? []).slice(0, 4),
  };
}

export const search = action({
  args: {
    query: v.optional(v.string()),
    mood: v.optional(v.string()),
    page: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { query: q, mood, page },
  ): Promise<{ configured: boolean; tracks: PlatformTrack[]; hasMore: boolean }> => {
    const clientId = await requireCaller(ctx);
    const key = apiKey();
    if (!key) return { configured: false, tracks: [], hasMore: false };
    await enforceRateLimit(ctx, "searchMusic", clientId);

    const words = [(q ?? "").trim().slice(0, 80), MOODS[mood ?? ""] ?? ""].filter(Boolean).join(" ");
    const params = new URLSearchParams({
      // No "music" word appended: the tag filter below already means music,
      // and every extra word narrows an all-words-must-match search.
      query: words || "background",
      // Music beds, not sound effects: tagged as music, long enough to sit
      // under a video, short of a full album side -- and public domain only.
      filter: 'license:"Creative Commons 0" tag:music duration:[12 TO 300]',
      sort: words ? "score" : "downloads_desc",
      fields: FIELDS,
      page_size: "18",
      page: String(Math.max(1, Math.min(20, Math.round(page ?? 1)))),
      token: key,
    });
    const res = await freesoundFetch(`${API}/search/text/?${params}`);
    if (res.status === 401) throw new Error("The Freesound API key was rejected. Check FREESOUND_API_KEY.");
    if (!res.ok) throw new Error(`Music search failed (${res.status}). Try again in a moment.`);
    const body = (await res.json()) as { results?: FreesoundSound[]; next?: string | null };
    return {
      configured: true,
      tracks: (body.results ?? []).map(toTrack).filter((t): t is PlatformTrack => t !== null),
      hasMore: Boolean(body.next),
    };
  },
});

/**
 * Picking a Platform track: copy it into the shared library once, and hand
 * back the same "template:<id>" ref a curated track has -- so every run
 * resolves it through lib/audioRef.ts unchanged, and a job made today keeps
 * its music even if the track later disappears from Freesound.
 *
 * Freesound's downloadable original needs a per-user OAuth login, so it is
 * the high-quality MP3 preview that's stored: a 128kbps stereo file, which is
 * the quality every platform re-encodes a phone video's audio to anyway.
 */
export const importTrack = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<{ ref: string; name: string }> => {
    const clientId = await requireCaller(ctx);
    if (!/^\d{1,12}$/.test(id)) throw new Error("That track isn't available.");

    const existing = await ctx.runQuery(internal.audio.templateBySource, {
      source: "freesound",
      sourceId: id,
    });
    if (existing) return { ref: `template:${existing._id}`, name: existing.name };

    const key = apiKey();
    if (!key) throw new Error("Platform music isn't set up on this deployment yet.");
    await enforceRateLimit(ctx, "searchMusic", clientId);

    const res = await freesoundFetch(
      `${API}/sounds/${id}/?${new URLSearchParams({ fields: FIELDS, token: key })}`,
    );
    if (!res.ok) throw new Error("That track isn't available any more.");
    const sound = (await res.json()) as FreesoundSound;
    const track = toTrack(sound);
    // Re-checked here: the licence is the whole reason this source was chosen.
    if (!track) throw new Error("That track isn't public domain, so it can't be used.");

    // Freesound's CDN can be slow -- a 1.3MB preview has taken 34s -- so the
    // download gets two minutes, and is read to the end before it's stored:
    // handed over as a stream, a timeout mid-download aborts the store too.
    let bytes: ArrayBuffer;
    try {
      const audio = await fetch(track.previewUrl, { signal: AbortSignal.timeout(120_000) });
      if (!audio.ok) throw new Error(`Couldn't download the track (${audio.status}).`);
      bytes = await audio.arrayBuffer();
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Couldn't")) throw e;
      throw new Error("The track took too long to download. Try again, or pick another.");
    }
    if (bytes.byteLength > 12_000_000) throw new Error("That track is too large to use.");
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const storageId = await ctx.storage.store(blob);

    const templateId = await ctx.runMutation(internal.audio.recordImported, {
      name: track.name,
      storageId,
      mimeType: "audio/mpeg",
      bytes: blob.size,
      durationSec: sound.duration,
      tags: track.tags,
      source: "freesound",
      sourceId: id,
      creator: track.creator,
      license: sound.license,
      sourceUrl: `https://freesound.org/s/${id}/`,
    });
    return { ref: `template:${templateId}`, name: track.name };
  },
});

/**
 * What an audio ref is, for the panel's summary card: a name, a length and
 * something to play. Null for silence / the clip's own sound, or for a ref
 * that isn't the caller's.
 */
export const describe = query({
  args: { ref: v.string() },
  handler: async (ctx, { ref }) => {
    const client = await currentClient(ctx);
    if (!client) return null;
    if (ref.startsWith("template:")) {
      const templateId = ctx.db.normalizeId("audioTemplates", ref.slice(9));
      const t = templateId ? await ctx.db.get(templateId) : null;
      if (!t) return null;
      return {
        name: t.name,
        durationSec: t.durationSec ?? null,
        creator: t.creator ?? null,
        from: t.source ? "Platform" : "House library",
        url: await ctx.storage.getUrl(t.storageId),
      };
    }
    const assetId = ctx.db.normalizeId("assets", ref);
    const asset = assetId ? await ctx.db.get(assetId) : null;
    if (!asset || asset.clientId !== client._id || asset.kind !== "audio") return null;
    return {
      name: "Your upload",
      durationSec: asset.durationSec ?? null,
      creator: null,
      from: "My audio",
      url: await ctx.storage.getUrl(asset.storageId),
    };
  },
});
