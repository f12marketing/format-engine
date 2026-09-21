"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Pulls one video's bytes out of a ScrapeCreators lookup response.
 *
 * UNVERIFIED against a real response: this project has never had a
 * SCRAPECREATORS_API_KEY, so this shape is built from the vendor's documented
 * field names (`download_no_watermark_addr`, `play_addr`, `has_watermark`)
 * rather than an observed payload. It tries several plausible nesting depths
 * -- ScrapeCreators' own top level, a `video` object (their documented
 * shape), and an `aweme_detail.video` object (TikTok's own internal shape,
 * which some scrapers pass through unflattened) -- so the first real
 * ingestion has a real chance of working, but this is exactly the kind of
 * thing to re-check against an actual response the moment a key exists.
 */
function pickDownloadUrl(body: unknown): string | null {
  const candidates = [
    pickField(body, [["download_no_watermark_addr"]]),
    pickField(body, [["video", "download_no_watermark_addr"]]),
    pickField(body, [["aweme_detail", "video", "download_no_watermark_addr"]]),
    pickField(body, [["play_addr"]]),
    pickField(body, [["video", "play_addr"]]),
    pickField(body, [["aweme_detail", "video", "play_addr"]]),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
    const fromList = pickField(c, [["url_list", "0"], ["urlList", "0"]]);
    if (typeof fromList === "string" && fromList) return fromList;
  }
  return null;
}

/** Walks a response of unknown shape; array indices are written as "0", "1", ... */
function pickField(body: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: unknown = body;
    for (const key of path) {
      cur = cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined;
    }
    if (cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

/**
 * Fetches one TikTok video via ScrapeCreators and stores it in the shared
 * clip library. A "use node" action because the video download can run to
 * tens of megabytes -- past what the default 64MB-heap action runtime should
 * be trusted with, per the same lesson `nodeStorage.ts` already applied to
 * render-service output.
 */
export const ingestTikTok = internalAction({
  args: { sourceUrl: v.string(), tags: v.optional(v.array(v.string())) },
  handler: async (ctx, { sourceUrl, tags }): Promise<Id<"clips">> => {
    const apiKey = (process.env.SCRAPECREATORS_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error(
        "SCRAPECREATORS_API_KEY is not set. Get a key from scrapecreators.com and run: " +
          "npx convex env set SCRAPECREATORS_API_KEY <key>",
      );
    }

    const metaRes = await fetch(
      `https://api.scrapecreators.com/v2/tiktok/video?url=${encodeURIComponent(sourceUrl)}`,
      { headers: { "x-api-key": apiKey } },
    );
    const metaBody = await metaRes.json().catch(() => null);
    if (!metaRes.ok) {
      throw new Error(
        `ScrapeCreators lookup failed: ${metaRes.status} ${JSON.stringify(metaBody)}`,
      );
    }

    const downloadUrl = pickDownloadUrl(metaBody);
    if (!downloadUrl) {
      throw new Error(
        `ScrapeCreators response had no recognised download URL field. Top-level keys: ` +
          `${Object.keys((metaBody as object) ?? {}).join(", ")}`,
      );
    }

    const vidRes = await fetch(downloadUrl);
    if (!vidRes.ok) throw new Error(`clip download failed: ${vidRes.status}`);
    const buf = Buffer.from(await vidRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([buf], { type: "video/mp4" }));

    const durationMs = Number(
      pickField(metaBody, [["video", "duration"], ["aweme_detail", "video", "duration"], ["duration"]]) ?? 0,
    );
    const width = Number(
      pickField(metaBody, [["video", "width"], ["aweme_detail", "video", "width"], ["width"]]) ?? 0,
    );
    const height = Number(
      pickField(metaBody, [["video", "height"], ["aweme_detail", "video", "height"], ["height"]]) ?? 0,
    );
    const creatorHandle = pickField(metaBody, [
      ["author", "unique_id"],
      ["aweme_detail", "author", "unique_id"],
    ]) as string | undefined;
    const music = pickField(metaBody, [
      ["music"],
      ["music_info"],
      ["aweme_detail", "music"],
    ]);

    return await ctx.runMutation(internal.clips.record, {
      source: "tiktok",
      sourceUrl,
      creatorHandle,
      storageId,
      // Duration arrives in milliseconds in every TikTok-shaped API observed
      // so far; if ScrapeCreators already reports seconds this will read
      // 1000x long, which is exactly the kind of thing to catch on the first
      // real ingestion rather than assume away.
      durationSec: durationMs > 0 ? durationMs / 1000 : 0,
      width,
      height,
      hasMusic: music !== undefined ? Boolean(music) : undefined,
      tags: tags ?? [],
    });
  },
});
