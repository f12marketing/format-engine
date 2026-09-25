"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * A playable URL for a video ref ("clip:<id>" or "video:<assetId>") -- the
 * browser-side twin of convex/lib/videoRef.ts's resolveVideoUrl, for
 * previews. Null while loading, when nothing is chosen, or when the value is
 * a person rather than a video.
 */
export function useVideoRefUrl(ref: string | null | undefined): string | null {
  const clipId = ref?.startsWith("clip:") ? (ref.slice(5) as Id<"clips">) : null;
  const assetId = ref?.startsWith("video:") ? (ref.slice(6) as Id<"assets">) : null;

  const clip = useQuery(api.clips.get, clipId ? { clipId } : "skip");
  const urls = useQuery(api.assets.urlsFor, assetId ? { assetIds: [assetId] } : "skip");

  if (clipId) return clip?.url ?? null;
  if (assetId) return urls?.[0]?.url ?? null;
  return null;
}
