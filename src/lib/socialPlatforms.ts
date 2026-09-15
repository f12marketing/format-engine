/**
 * What each platform will and won't accept.
 *
 * Read off Zernio's own platform pages. Duplicated here rather than fetched
 * because the composer has to tell you a 16:9 video won't go to TikTok
 * *before* you schedule it -- discovering that from a failed publish two hours
 * later is the outcome this exists to prevent. Zernio's /v1/validate remains
 * the authority at submit time; this is the fast local pass.
 */

export type Platform = "tiktok" | "instagram" | "youtube" | "linkedin";

export interface PlatformSpec {
  id: Platform;
  name: string;
  /** Caption/description ceiling. YouTube's title is counted separately. */
  captionLimit: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  maxBytes: number;
  /** True where anything but vertical is a bad post rather than a rejected one. */
  prefersVertical?: boolean;
  /** Shown in the composer so the rule is visible before it's broken. */
  note?: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLATFORMS: Record<Platform, PlatformSpec> = {
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    captionLimit: 2200,
    minDurationSec: 3,
    maxDurationSec: 600,
    maxBytes: 4 * GB,
    prefersVertical: true,
    note: "9:16 only in practice. Requires confirming the preview and consent.",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    captionLimit: 2200,
    minDurationSec: 3,
    maxDurationSec: 90,
    maxBytes: 300 * MB,
    prefersVertical: true,
    note: "Reels are 9:16 and up to 90s. Business or Creator accounts only.",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    captionLimit: 5000,
    maxDurationSec: 900,
    maxBytes: 256 * GB,
    note: "Shorts are vertical and up to 3 minutes. 15 minutes on an unverified channel.",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    captionLimit: 3000,
    maxDurationSec: 600,
    maxBytes: 5 * GB,
    note: "10 minutes on a personal profile, 30 on a company page.",
  },
};

export const YOUTUBE_TITLE_LIMIT = 100;

export interface MediaFacts {
  kind: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

/**
 * Everything wrong with posting this media and caption to this platform.
 *
 * Returns blocking problems only. Where a fact is unknown -- dimensions and
 * duration aren't recorded for every asset -- the check is skipped rather
 * than guessed at, because refusing to schedule over missing metadata is
 * worse than letting Zernio have the final say.
 */
export function preflight(
  platform: Platform,
  caption: string,
  media: MediaFacts | null,
): string[] {
  const spec = PLATFORMS[platform];
  const issues: string[] = [];

  if (caption.length > spec.captionLimit) {
    issues.push(
      `Caption is ${caption.length} characters; ${spec.name} allows ${spec.captionLimit}.`,
    );
  }

  if (!media) {
    // Every one of the four rejects a text-only post.
    issues.push(`${spec.name} needs a video or image.`);
    return issues;
  }

  if (media.bytes > spec.maxBytes) {
    issues.push(
      `File is ${(media.bytes / MB).toFixed(0)} MB; ${spec.name} caps at ${(
        spec.maxBytes / MB
      ).toFixed(0)} MB.`,
    );
  }

  if (media.durationSec !== undefined) {
    if (spec.minDurationSec !== undefined && media.durationSec < spec.minDurationSec) {
      issues.push(`${spec.name} needs at least ${spec.minDurationSec}s of video.`);
    }
    if (spec.maxDurationSec !== undefined && media.durationSec > spec.maxDurationSec) {
      issues.push(
        `Video is ${Math.round(media.durationSec)}s; ${spec.name} caps at ${spec.maxDurationSec}s.`,
      );
    }
  }

  if (
    spec.prefersVertical &&
    media.width !== undefined &&
    media.height !== undefined &&
    media.width > media.height
  ) {
    issues.push(
      `${spec.name} expects a vertical 9:16 video; this one is ${media.width}×${media.height}.`,
    );
  }

  return issues;
}

/** Zernio's `platformSpecificData`, keyed by platform exactly as its API expects. */
export interface TikTokSettings {
  privacy_level: string;
  allow_comment: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  content_preview_confirmed: boolean;
  express_consent_given: boolean;
}

export const TIKTOK_PRIVACY_LEVELS = [
  { value: "PUBLIC_TO_EVERYONE", label: "Public" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { value: "SELF_ONLY", label: "Private" },
] as const;

export const YOUTUBE_VISIBILITIES = ["public", "unlisted", "private"] as const;
