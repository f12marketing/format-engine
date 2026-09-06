import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";

/**
 * Custom: an upload, framed to a target ratio, with optional text and overlay.
 *
 * The second format, and the one that costs nothing to run -- no model calls at
 * all. Its whole job is to push the render service: uploads, dimensions, the
 * caption-style system, compositing. Everything Phase 1 is actually about.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.custom.compose, args, { retry: true });
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "done",
      });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

/**
 * P7 + P8 in one hop.
 *
 * Both steps land on the same ffmpeg invocation -- splitting them would mean
 * encoding an intermediate file twice for no benefit -- so the job records one
 * composite step rather than pretending there were two.
 */
export const compose = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
    if (!base) throw new Error("RENDER_SERVICE_URL is not set on the deployment.");

    const config = job.config as {
      sourceAssetId?: Id<"assets">;
      overlayAssetId?: Id<"assets">;
      dimensions?: string;
      fit?: string;
      text?: string;
      captionStyle?: string;
      captionPosition?: string;
      durationSec?: number;
    };

    if (!config.sourceAssetId) {
      throw new Error("A source video or image is required.");
    }

    const source = await ctx.runAction(internal.custom.readAsset, {
      assetId: config.sourceAssetId,
    });
    if (!source) throw new Error("The source upload could not be read.");

    const overlay = config.overlayAssetId
      ? await ctx.runAction(internal.custom.readAsset, {
          assetId: config.overlayAssetId,
        })
      : null;

    const res = await fetch(`${base}/render/custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        overlay,
        dimensions: config.dimensions ?? "9:16",
        fit: config.fit === "Fill (crop)" ? "cover" : "contain",
        text: config.text ?? "",
        captionStyle: config.captionStyle ?? "Classic",
        captionPosition: config.captionPosition ?? "bottom",
        durationSec: config.durationSec ?? 5,
      }),
    });
    if (!res.ok) {
      throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    }

    const out = (await res.json()) as {
      width: number;
      height: number;
      files: { name: string; contentType: string; base64: string }[];
    };

    const assetIds: Id<"assets">[] = [];
    for (const file of out.files) {
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const storageId = await ctx.storage.store(
        new Blob([bytes as unknown as BlobPart], { type: file.contentType }),
      );
      assetIds.push(
        await ctx.runMutation(internal.assets.record, {
          clientId,
          producedByJobId: jobId,
          storageId,
          mimeType: file.contentType,
          bytes: bytes.byteLength,
          width: out.width,
          height: out.height,
        }),
      );
    }

    // No model ran, so the row is zero -- but it exists, because "this step
    // happened and was free" reads very differently from a missing line.
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "composite",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });

    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "composite",
      state: "done",
      output: { files: out.files.map((f) => ({ name: f.name })) },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

/**
 * Reads a stored asset back as base64 for the render service.
 *
 * Known limit, and the first thing to change when real footage arrives: this
 * round-trips whole files through JSON. Fine for images and short clips, wrong
 * for a 200MB demo video -- at which point the render service should be handed
 * a signed URL and fetch the bytes itself.
 */
export const readAsset = internalAction({
  args: { assetId: v.id("assets") },
  handler: async (
    ctx,
    { assetId },
  ): Promise<{ base64: string; contentType: string } | null> => {
    const asset = await ctx.runQuery(internal.custom.assetRow, { assetId });
    if (!asset) return null;
    const blob = await ctx.storage.get(asset.storageId);
    if (!blob) return null;
    const buf = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000; // btoa on a huge spread blows the call stack
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { base64: btoa(binary), contentType: asset.mimeType };
  },
});

export const assetRow = internalQuery({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => ctx.db.get(assetId),
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.custom.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
