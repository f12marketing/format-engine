import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * What `field.audioClip()` stores: a plain string naming either a house
 * audio template or one of the client's own uploads.
 *
 * Same shape as roster.ts's avatar/influencer refs, and for the same reason --
 * Convex's id validators don't support a union of two tables, so the shared
 * library's rows are tagged ("template:<id>") and anything untagged is read as
 * a bare `assets` id. An empty ref means silent, which on these formats is a
 * real choice rather than an unset field.
 */
export type AudioRef = string;

const TEMPLATE_PREFIX = "template:";

export function audioTemplateRef(templateId: Id<"audioTemplates">): AudioRef {
  return `${TEMPLATE_PREFIX}${templateId}`;
}

export function isTemplateRef(ref: AudioRef): boolean {
  return ref.startsWith(TEMPLATE_PREFIX);
}

/**
 * Resolves either kind of ref to a playable URL.
 *
 * A client's own upload is ownership-checked; a template is not, because the
 * library is shared by construction -- but it is still only reachable from an
 * action a signed-in client started.
 */
export async function resolveAudioUrl(
  ctx: ActionCtx,
  ref: AudioRef | undefined | null,
  clientId: Id<"clients">,
): Promise<string | null> {
  if (!ref) return null; // silent

  if (isTemplateRef(ref)) {
    const template = await ctx.runQuery(internal.audio.getTemplateInternal, {
      templateId: ref.slice(TEMPLATE_PREFIX.length) as Id<"audioTemplates">,
    });
    if (!template) throw new Error("That audio template could not be found.");
    return ctx.storage.getUrl(template.storageId);
  }

  const asset = await ctx.runQuery(internal.assets.getInternal, {
    assetId: ref as Id<"assets">,
  });
  // An id is not an authorisation -- a ref naming someone else's upload
  // resolves to nothing rather than to their audio.
  if (!asset || asset.clientId !== clientId) {
    throw new Error("That audio clip could not be found.");
  }
  return ctx.storage.getUrl(asset.storageId);
}
