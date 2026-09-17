import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { submitWithContentPolicyFallback } from "./fal";

/**
 * P2, shared by Claymation and Skeleton -- byte-identical composite calls
 * that differ only in the art-direction text, which is exactly the bet
 * `clayLikePipeline(artDirection)` was already built on. `artDirection` is a
 * literal string each format's own `run()` passes in (mirroring how
 * `avatarPrimitive` callers pass a literal prompt) -- the `options.artDirection`
 * declared on the Step in `planned.ts` is UI-facing metadata only, nothing
 * server-side reads a Step's `options` at run time.
 */
const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K

export const composeClayScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients"), artDirection: v.string() },
  handler: async (ctx, { jobId, clientId, artDirection }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { productImage?: Id<"assets">; prompt?: string; style?: string };
    if (!config.productImage) throw new Error("A product image is required.");

    const asset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.productImage,
    });
    if (!asset) throw new Error("The product image could not be found.");
    const imageUrl = await ctx.storage.getUrl(asset.storageId);
    if (!imageUrl) throw new Error("Could not read the product image.");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const topic = (config.prompt ?? "").trim();
    // Match lighting/shadow/perspective explicitly -- an image-edit composite's
    // most common tell is a pasted-in subject whose shadow falls the wrong way
    // for the scene it landed in. Product Spokesperson and Green Screen
    // Mobile's own composites already carry this instruction; this primitive
    // never did, despite doing the same @image1-into-a-scene job.
    const wrap = (body: string) =>
      `${artDirection} @image1 is the product. ${body}${topic ? ` Context: ${topic}.` : ""} ` +
      `${config.style ? `Style: ${config.style}.` : ""} Match the product's lighting, shadow ` +
      "direction and scale to the surrounding scene. High quality render, no text, no watermark, no UI elements.";

    const buildInput = (prompt: string) => ({
      prompt,
      image_urls: [imageUrl],
      num_images: 1,
    });

    const result = (await submitWithContentPolicyFallback(
      "alibaba/qwen-image-3/edit",
      buildInput,
      wrap("Place the product naturally into the scene, as the clear focal point."),
      () => wrap("Show the product plainly in the scene."),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no scene image returned");

    // Persisted rather than kept as fal's own URL -- same reasoning as every
    // other composite step here: a remix can re-read this output long after
    // fal's result URL is guaranteed to stay fetchable.
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch scene image: ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
    const storedUrl = await ctx.storage.getUrl(storageId);
    if (!storedUrl) throw new Error("could not read back the stored scene image");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scene",
      primitive: "P2",
      model: "alibaba/qwen-image-3/edit",
      units: 1,
      unitLabel: "images",
      costUsd: COMPOSITE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scene",
      state: "done",
      output: { imageUrl: storedUrl },
    });
    return null;
  },
});
