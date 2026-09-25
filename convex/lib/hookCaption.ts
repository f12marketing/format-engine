import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { renderServiceBase, renderServiceHeaders } from "./renderService";
import { wallLayerHtml, type WallDesign } from "./wallOfTextDesign";

/**
 * The hook + demo formats' caption: edited in Wall of Text's studio, then
 * burned onto the hook alone -- by Wall of Text's renderer, so it is drawn
 * from the very HTML the studio previewed -- and cut to `seconds` there, so a
 * long clip isn't encoded for nothing. The stitch then joins the demo on
 * uncaptioned.
 *
 * The result is only ever an input to that stitch: the caller deletes it
 * once the stitch has read it.
 */
export async function captionHook(
  ctx: ActionCtx,
  hookUrl: string,
  design: WallDesign,
  seconds: number,
): Promise<{ url: string; storageId: Id<"_storage"> }> {
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const res = await fetch(`${renderServiceBase()}/render/wall-of-text`, {
    method: "POST",
    headers: renderServiceHeaders(),
    body: JSON.stringify({
      layerHtml: wallLayerHtml(design, null),
      videoUrl: hookUrl,
      // The hook keeps its own sound here; music, if any, is laid on in the stitch.
      audioUrl: null,
      maxDurationSec: seconds,
      uploadUrl,
    }),
  });
  if (!res.ok) throw new Error(`render service failed captioning the hook: ${res.status} ${await res.text()}`);
  const out = (await res.json()) as { storageId?: Id<"_storage"> };
  if (!out.storageId) {
    throw new Error(
      "The render service is running old code that can't put text on a video. Restart it (cd ../render-service && npm start) and save again.",
    );
  }
  const url = await ctx.storage.getUrl(out.storageId);
  if (!url) throw new Error("could not read back the captioned hook");
  return { url, storageId: out.storageId };
}
