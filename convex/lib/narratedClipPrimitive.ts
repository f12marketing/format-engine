import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { renderServiceBase, renderServiceHeaders } from "./renderService";

/**
 * P8, shared by Cutting Fruit, Claymation and Skeleton -- muxes the narration
 * audio onto the generated clip and burns the narration as a caption, in one
 * call. No format-specific renderer needed: `/render/video-animation` already
 * takes exactly this shape (`{ videoUrl, audioUrl, durationSec, caption }`)
 * per shot for Video Animation's multi-shot stitch, and a one-element array
 * is a valid (if trivial) `concat` for it -- reusing it here is the same move
 * as Speaking Hook & Demo reusing `/render/video-hook-demo` for its own
 * "stitch" step, or the avatar formats reusing `/render/custom` for "caption".
 *
 * FLAG: Cutting Fruit's own "Audio" field (music bed / kitchen sound /
 * silent) isn't mixed in here -- this only carries the narration track. That
 * ambiguity was already flagged as unresolved in the format's own config;
 * layering a second audio bed under narration is left for later rather than
 * guessed at now.
 */
export const renderNarratedClip = internalAction({
  args: {
    jobId: v.id("jobs"),
    clientId: v.id("clients"),
    dimensions: v.optional(v.string()),
    /** Which config field holds the text when the copy step didn't run. */
    textConfigField: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, clientId, dimensions, textConfigField }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "captions", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const clip = job.steps.find((s) => s.id === "clip")?.output as
      | { videoUrl?: string; durationSec?: number }
      | undefined;
    if (!clip?.videoUrl) throw new Error("The scene has not been animated yet.");
    const speech = job.steps.find((s) => s.id === "speech")?.output as
      | { audioUrl?: string }
      | undefined;

    const config = job.config as Record<string, unknown>;
    // Either P1 wrote it (copy step's generic "text" key), or the user typed
    // it directly into whichever field holds this format's own text and P1
    // never ran.
    const written = (job.steps.find((s) => s.id === "copy")?.output as { text?: string } | undefined)
      ?.text;
    const typed = config[textConfigField ?? "narration"] as string | undefined;
    const caption = (written ?? typed ?? "").trim();

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/video-animation`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        shots: [
          {
            videoUrl: clip.videoUrl,
            audioUrl: speech?.audioUrl ?? null,
            durationSec: clip.durationSec ?? 30,
            caption: caption || null,
          },
        ],
        dimensions: dimensions ?? "9:16",
        captionStyle: "Classic",
        uploadUrl,
      }),
    });
    if (!res.ok) throw new Error(`render service failed: ${res.status} ${await res.text()}`);

    const out = (await res.json()) as {
      width: number;
      height: number;
      storageId: Id<"_storage">;
      bytes: number;
      contentType: string;
    };

    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      producedByJobId: jobId,
      storageId: out.storageId,
      mimeType: out.contentType,
      bytes: out.bytes,
      width: out.width,
      height: out.height,
    });

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "captions",
      primitive: "P8",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "captions",
      state: "done",
      output: { files: [{ name: "output.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});
