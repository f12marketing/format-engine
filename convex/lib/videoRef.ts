import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * A finished video, as Wall of Text's Video field stores it: "clip:<id>" for
 * the shared trending library, "video:<assetId>" for one of the client's own.
 *
 * Tagged both ways because the same field also holds people to film (see
 * roster.ts, where a bare id is an avatar). A bare asset id is still read as
 * a video here -- the field stored uploads that way before it held people.
 */
export type VideoRef = string;

const CLIP_PREFIX = "clip:";
const VIDEO_PREFIX = "video:";

export function isClipRef(ref: VideoRef): boolean {
  return ref.startsWith(CLIP_PREFIX);
}

/** A finished clip rather than a person to film. */
export function isVideoRef(ref: VideoRef | undefined | null): boolean {
  return Boolean(ref && (ref.startsWith(CLIP_PREFIX) || ref.startsWith(VIDEO_PREFIX)));
}

/**
 * Resolves either kind of ref to a fetchable URL. An upload is
 * ownership-checked; a library clip is shared by construction.
 */
export async function resolveVideoUrl(
  ctx: ActionCtx,
  ref: VideoRef | undefined | null,
  clientId: Id<"clients">,
): Promise<string> {
  if (!ref) throw new Error("Choose a video first.");

  if (isClipRef(ref)) {
    const clip = await ctx.runQuery(internal.videoHookDemo.clipRow, {
      clipId: ref.slice(CLIP_PREFIX.length) as Id<"clips">,
    });
    if (!clip) throw new Error("The selected library clip no longer exists.");
    const url = await ctx.storage.getUrl(clip.storageId);
    if (!url) throw new Error("The selected library clip could not be read.");
    return url;
  }

  const asset = await ctx.runQuery(internal.assets.getInternal, {
    assetId: (ref.startsWith(VIDEO_PREFIX) ? ref.slice(VIDEO_PREFIX.length) : ref) as Id<"assets">,
  });
  // An id is not an authorisation -- someone else's upload resolves to nothing.
  if (!asset || asset.clientId !== clientId || asset.kind !== "video") {
    throw new Error("That video could not be found.");
  }
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("That video could not be read.");
  return url;
}
