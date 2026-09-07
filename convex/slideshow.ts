import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL, submitAndPoll } from "./lib/fal";

/**
 * Slideshow: the format that finally exercises P2.
 *
 * Every format before this one either called no model (Custom, Wall of Text)
 * or an LLM only (Carousel). This is the first real image generation --
 * fal-ai/nano-banana, ported from the old app's stage_images() -- which makes
 * it the format that actually proves the P2 primitive rather than just
 * declaring it.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.slideshow.writePlan, args, { retry: true });
      await step.runAction(internal.slideshow.generateImages, args, { retry: true });
      await step.runAction(internal.slideshow.render, args, { retry: true });
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

const SLIDESHOW_SYSTEM = `You plan a short vertical slideshow video: a sequence of generated images,
each on screen for a few seconds with one short line of text.

For each slide, write:
- imagePrompt: what the image shows. Concrete, visual, no text or lettering in
  the image itself -- the caption is drawn separately. One clear subject per
  slide; do not describe a whole scene of unrelated things.
- caption: at most 90 characters, plain language, no markdown, no emoji, no
  hashtags. It should make sense read on its own, in three seconds, without
  the slides before or after it.

The slides together should read as one short narrative arc: an opening that
earns attention, a middle that develops the idea, and a close that lands it --
proportioned to however many slides you were asked for.`;

const SLIDESHOW_TOOL = {
  name: "save_slideshow",
  description: "Save the slideshow plan.",
  input_schema: {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            imagePrompt: { type: "string" },
            caption: { type: "string", description: "At most 90 characters." },
          },
          required: ["imagePrompt", "caption"],
        },
      },
    },
    required: ["slides"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
const IMAGE_PRICE_PER_UNIT = 0.08; // fal-ai/nano-banana-2, per image at 1K
const MAX_CAPTION_CHARS = 90;

interface SlidePlan {
  imagePrompt: string;
  caption: string;
}

export const writePlan = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const config = job.config as { prompt?: string; images?: number; style?: string };
    const subject = (config.prompt ?? "").trim();
    const count = config.images ?? 10;
    const style = config.style ?? "Photorealistic, cinematic photography, natural lighting";

    // FLAG (spec ambiguity, not invented): the spec marks Prompt optional on
    // Slideshow the same as it does on Carousel, but a carousel can fall back
    // to a hand-written deck -- Slideshow has no equivalent, since the images
    // must come from somewhere. Treated as required until told otherwise.
    if (!subject) {
      throw new Error(
        "A prompt is required to generate slide images -- there is no " +
          "hand-written fallback the way there is for a carousel deck.",
      );
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: 0.05,
    });

    const call = await callTool(
      SLIDESHOW_SYSTEM,
      `Plan a ${count}-slide slideshow. Visual style: ${style}.\n\nSubject:\n\n${subject}`,
      SLIDESHOW_TOOL as never,
    );
    const slides = (call.value as { slides?: SlidePlan[] })?.slides ?? [];
    if (slides.length < 3) {
      throw new Error(`model returned only ${slides.length} slide(s) -- need at least 3`);
    }

    const over = slides
      .map((s, i) => ({ i, len: (s.caption ?? "").length }))
      .filter((s) => s.len > MAX_CAPTION_CHARS);
    if (over.length) {
      throw new Error(
        `caption exceeded ${MAX_CAPTION_CHARS} chars on slide(s): ` +
          over.map((s) => `${s.i + 1} (${s.len})`).join(", "),
      );
    }

    const costUsd =
      (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M;

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { slides },
    });
    return null;
  },
});

/**
 * P2. One nano-banana call per slide, run in parallel -- these are
 * independent images, not a sequence that depends on a prior step's output,
 * so there is nothing to gain from doing them one at a time.
 */
export const generateImages = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "images",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const plan = (job.steps.find((s) => s.id === "copy")?.output as
      | { slides?: SlidePlan[] }
      | undefined)?.slides;
    if (!plan?.length) throw new Error("no slide plan to generate images from");

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: plan.length * IMAGE_PRICE_PER_UNIT,
    });

    const urls = await Promise.all(
      plan.map(async (slide) => {
        // Same request shape as the old app's stage_images(): nano-banana,
        // one image, a fixed safety tolerance that has been fine in practice.
        const result = (await submitAndPoll("fal-ai/nano-banana-2", {
          prompt: slide.imagePrompt,
          aspect_ratio: "9:16",
          output_format: "png",
          safety_tolerance: "4",
          num_images: 1,
        })) as { images?: { url?: string }[] };
        const url = result.images?.[0]?.url;
        if (!url) throw new Error(`no image returned for prompt: ${slide.imagePrompt}`);
        return url;
      }),
    );

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "images",
      primitive: "P2",
      model: "fal-ai/nano-banana-2",
      units: plan.length,
      unitLabel: "images",
      costUsd: plan.length * IMAGE_PRICE_PER_UNIT,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "images",
      state: "done",
      output: { urls },
    });
    return null;
  },
});

export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
    if (!base) throw new Error("RENDER_SERVICE_URL is not set on the deployment.");

    const plan = (job.steps.find((s) => s.id === "copy")?.output as
      | { slides?: SlidePlan[] }
      | undefined)?.slides;
    const urls = (job.steps.find((s) => s.id === "images")?.output as
      | { urls?: string[] }
      | undefined)?.urls;
    if (!plan?.length || !urls?.length) throw new Error("missing plan or generated images");

    // fal already hosts these at a public URL, so the render service fetches
    // them directly rather than Convex downloading and re-uploading as
    // base64 first -- one fewer round trip for exactly the case that would
    // hurt most (N images, not one).
    const res = await fetch(`${base}/render/slideshow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: urls.map((url) => ({ url })),
        captions: plan.map((s) => s.caption),
        dimensions: "9:16",
        secondsPerImage: 3,
        captionStyle: "Classic",
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

    // Delegated to a "use node" action -- see nodeStorage.ts. The default
    // action runtime's 64MB heap ceiling is a real limit a per-character
    // atob() decode can cross; this was found on Video Animation's stitched
    // output and applies here too as outputs grow.
    const assetIds = await ctx.runAction(internal.lib.nodeStorage.storeRenderedFiles, {
      clientId,
      jobId,
      files: out.files,
      width: out.width,
      height: out.height,
    });

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "render",
      primitive: "P8",
      model: "chrome+ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      output: { files: out.files.map((f) => ({ name: f.name })) },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.slideshow.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
