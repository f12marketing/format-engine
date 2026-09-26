import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { submitWithContentPolicyFallback } from "./fal";
import { briefToPrompt, groundScene } from "./grounding";

/**
 * P2, shared by Claymation, Lego, Felt and Talking Objects -- byte-identical
 * scene calls that differ only in the art-direction text, which is exactly
 * the bet `clayLikePipeline(artDirection)` was already built on.
 * `artDirection` is a literal string each format's own `run()` passes in
 * (mirroring how `avatarPrimitive` callers pass a literal prompt) -- the
 * `options.artDirection` declared on the Step in `planned.ts` is UI-facing
 * metadata only, nothing server-side reads a Step's `options` at run time.
 *
 * The product image is optional. With one, it is composited into the styled
 * set (an image edit, so the product keeps its real shape and label). With
 * none, the scene is drawn from the prompt alone (a text-to-image call), so
 * "a person building a house in Antarctica" no longer needs a photo of
 * something to stand in for the subject -- which is what the first test of
 * this format had to do.
 */
const COMPOSITE_MODEL = "alibaba/qwen-image-3/edit";
const COMPOSITE_PRICE_PER_UNIT = 0.04; // alibaba/qwen-image-3/edit at 1K
const DRAW_MODEL = "fal-ai/nano-banana-2";
const DRAW_PRICE_PER_UNIT = 0.08; // fal-ai/nano-banana-2 at 1K
// Mirrored in src/lib/estimate.ts, which prices the two paths from the same field.

export const composeClayScene = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients"), artDirection: v.string() },
  handler: async (ctx, { jobId, clientId, artDirection }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as {
      productImage?: Id<"assets">;
      prompt?: string;
      narration?: string;
      style?: string;
    };

    // Narration written by hand stands in for a prompt: it is just as good a
    // description of what the scene should show.
    const topic = (config.prompt ?? "").trim() || (config.narration ?? "").trim();

    let productUrl: string | null = null;
    if (config.productImage) {
      const asset = await ctx.runQuery(internal.assets.getInternal, {
        assetId: config.productImage,
      });
      if (!asset) throw new Error("The product image could not be found.");
      productUrl = await ctx.storage.getUrl(asset.storageId);
      if (!productUrl) throw new Error("Could not read the product image.");
    } else if (!topic) {
      throw new Error("Give a prompt, or a product image, so there is something to build the scene around.");
    }

    const model = productUrl ? COMPOSITE_MODEL : DRAW_MODEL;
    const price = productUrl ? COMPOSITE_PRICE_PER_UNIT : DRAW_PRICE_PER_UNIT;
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: price * 1.2 + 0.02,
    });

    // Work out what the topic really involves before drawing it -- the
    // clothing, materials and surroundings the place and the job actually
    // demand. See convex/lib/grounding.ts for why this is a text step.
    const grounded = topic
      ? await groundScene(topic, {
          style: config.style,
          artDirection,
          hasSubjectImage: Boolean(productUrl),
        })
      : null;
    if (grounded) {
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "scene",
        primitive: "P1",
        model: grounded.model,
        units: grounded.inputTokens + grounded.outputTokens,
        unitLabel: "tokens",
        costUsd: grounded.costUsd,
      });
    }
    const scene = grounded ? briefToPrompt(grounded.brief) : "";
    // The mistakes this exact topic invites, named by the model that just
    // reasoned about it, so the image model is told what NOT to draw.
    const avoid = grounded?.brief.avoid ? ` Do not include: ${grounded.brief.avoid}.` : "";

    // Match lighting/shadow/perspective explicitly -- an image-edit composite's
    // most common tell is a pasted-in subject whose shadow falls the wrong way
    // for the scene it landed in. Product Spokesperson and Green Screen
    // Mobile's own composites already carry this instruction; this primitive
    // never did, despite doing the same @image1-into-a-scene job.
    const wrap = (body: string) =>
      productUrl
        ? `${artDirection} @image1 is the product. ${body} ` +
          `${scene || (topic ? `Context: ${topic}.` : "")} ` +
          `${config.style ? `Style: ${config.style}.` : ""} Match the product's lighting, shadow ` +
          "direction and scale to the surrounding scene." +
          avoid +
          " High quality render, no text, no watermark, no UI elements."
        : `${artDirection} ${body} ${scene || `Scene: ${topic}.`} ` +
          `${config.style ? `Style: ${config.style}. ` : ""}` +
          "Vertical 9:16 frame with the subject centered and fully in shot. Any figure has " +
          "correctly formed hands, each holding or resting on something." +
          avoid +
          " High quality render, no text, no watermark, no UI elements.";

    const buildInput = (prompt: string) =>
      productUrl
        ? { prompt, image_urls: [productUrl], num_images: 1 }
        : { prompt, aspect_ratio: "9:16", num_images: 1 };

    const result = (await submitWithContentPolicyFallback(
      model,
      buildInput,
      wrap(
        productUrl
          ? "Place the product naturally into the scene, as the clear focal point."
          : "Build the scene described below, with its subject as the clear focal point.",
      ),
      () => wrap(productUrl ? "Show the product plainly in the scene." : "Show the subject plainly in the scene."),
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
      model,
      units: 1,
      unitLabel: "images",
      costUsd: price,
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
