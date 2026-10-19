import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { requireClientForAction } from "./clients";
import { callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import { businessContext } from "./lib/businessContext";
import { enforceDailyImageCap, enforceRateLimit } from "./lib/rateLimit";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import {
  deckAssetIds,
  frameOf,
  sanitizeDeck,
  SLIDE_RATIOS,
  slidePageHtml,
  type SlideRatio,
} from "./lib/imageSlideshowDesign";
import { buildDeck, templateById, type WrittenSlide } from "./lib/imageSlideshowTemplates";
import { parseImageSource, slideCountFor, styleFor, type ImageSource } from "./lib/imageSets";

/**
 * Image Slideshow: a swipeable photo deck with text on every slide -- the
 * TikTok / Instagram photo-carousel.
 *
 * The photos are a stock image set (lib/imageSets.ts) or the client's own
 * uploads. P1 writes each slide's words in the text style the set calls for
 * and, for a set, matches one of its photos to every slide from what each
 * photo shows. The editor gate then parks the run -- suspended, costing
 * nothing -- while the client edits the deck on the job page: moves and
 * restyles text, swaps and adds images, adds overlays and slides. Approving
 * it is the editor's Save, and the export renders exactly the deck that was
 * approved, drawn by the same style functions the editor previewed it with
 * (lib/imageSlideshowDesign.ts).
 */
interface ImageSlideshowConfig {
  prompt?: string;
  mentionBusiness?: boolean;
  /** `set:<id>` or `uploads:<assetId>,...` -- see parseImageSource. */
  images?: string;
  /** Set by "Edit slides again": a finished job's deck, reopened in the editor. */
  deck?: unknown;
}

export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("copy")) {
        await step.runAction(internal.imageSlideshow.writeSlides, args, { retry: true });
      }
      await step.runAction(internal.imageSlideshow.openEditor, args, { retry: true });
      await passGate(step, args.jobId, "edit");
      await step.runAction(internal.imageSlideshow.render, args, { retry: true });
      await step.runMutation(internal.jobs.finish, { jobId: args.jobId, status: "done" });
    } catch (e) {
      await step.runMutation(internal.jobs.finish, {
        jobId: args.jobId,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  });

async function passGate(step: WorkflowCtx, jobId: Id<"jobs">, stepId: string): Promise<void> {
  await step.awaitEvent({ name: `approve:${jobId}:${stepId}` });
  await step.runMutation(internal.jobs.patchStep, { jobId, stepId, state: "done" });
  await step.runMutation(internal.jobs.setRunning, { jobId });
}

// ---------------------------------------------------------------- models and rates

/** Only the editor's "Generate" tab draws images now; the run itself uses the set's photos. */
const IMAGE_MODEL = "fal-ai/nano-banana-2";
const IMAGE_PRICE = 0.08; // per image at 1K -- mirrored by RATES.imagePerUnit in src/lib/estimate.ts
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

function llmCost(call: { inputTokens: number; outputTokens: number }): number {
  return (call.inputTokens / 1e6) * LLM_INPUT_PER_1M + (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M;
}

function ratioOf(r: unknown): SlideRatio {
  return SLIDE_RATIOS.includes(r as SlideRatio) ? (r as SlideRatio) : "3:4";
}

/** How the photo under a generated image should look: the style its set is written in. */
const GENERATED_LOOK =
  "photographic, natural light, candid and unposed, like a phone photo, no text, no watermark";

// ---------------------------------------------------------------- P1: words and photos

const WRITER_SYSTEM = `You write trending photo slideshows for TikTok and Instagram: a deck of
photos, swiped one by one, with short text on each. They are posted by real
people, so they never read like an ad.

Every slide gets:
- heading / body: the words on the slide, shaped exactly as the style says.
- photo: when a list of photos is given, the number of the photo that best
  fits what this slide says. Use each photo at most once while there are
  unused ones; the hook slide gets the most striking one.
- imagePrompt: one line describing an ideal photo for the slide, in case the
  person wants to generate a replacement. Never ask for text in it.

The slides together are one arc: a hook that earns the swipe, a middle that
delivers, and a last slide that lands it. No hashtags, no markdown.

When you are told to mention a business, work it in once, mid-deck or near
the end, the way someone passes on a find -- never as a slogan or a call to
action. The profile comes with a rule on whether the poster has used it;
follow it exactly. When they haven't, the deck's story is the problem and the
business is what they just found out about ("apparently X can...").`;

function writerTool(count: number, photos: number) {
  return {
    name: "save_slideshow",
    description: "Save the slideshow.",
    input_schema: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              body: { type: "string" },
              ...(photos ? { photo: { type: "integer", minimum: 1, maximum: photos } } : {}),
              imagePrompt: { type: "string" },
            },
            required: ["heading", "body", "imagePrompt", ...(photos ? ["photo"] : [])],
          },
        },
      },
      required: ["slides"],
    },
  };
}

type Written = WrittenSlide & { imagePrompt: string; imageAssetId: string | null };
type Drafted = WrittenSlide & { imagePrompt: string; photo: number };

/** However the model wrapped the list, as long as it is there. */
function slidesFrom(value: unknown): Drafted[] {
  const raw = (value as { slides?: unknown })?.slides;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown[];
          } catch {
            return [];
          }
        })()
      : [];
  return list
    .map((s) => s as Partial<Drafted>)
    .map((s) => ({
      heading: String(s.heading ?? "").trim().slice(0, 300),
      body: String(s.body ?? "").trim().slice(0, 500),
      imagePrompt: String(s.imagePrompt ?? "").trim().slice(0, 800),
      photo: Math.round(Number(s.photo) || 0),
    }))
    .filter((s) => s.heading || s.body);
}

/**
 * One photo per slide, from the writer's picks: a pick that is out of range
 * or already used (while unused ones remain) is replaced by the next unused
 * photo, so a deck never shows the same picture twice when it needn't.
 */
function assignPhotos(picks: number[], available: number): number[] {
  const used = new Set<number>();
  const next = () => {
    for (let i = 0; i < available; i++) if (!used.has(i)) return i;
    return -1;
  };
  return picks.map((p, slide) => {
    let i = p - 1;
    if (i < 0 || i >= available || (used.has(i) && used.size < available)) i = next();
    if (i < 0) i = slide % available;
    used.add(i);
    return i;
  });
}

/** The client's own images, owner-checked, in the order they were picked. */
async function ownImages(ctx: ActionCtx, clientId: Id<"clients">, ids: string[]): Promise<string[]> {
  const ok = await Promise.all(
    ids.map(async (id) => {
      const a = await ctx.runQuery(internal.assets.getInternal, { assetId: id as Id<"assets"> });
      return a && a.clientId === clientId && a.kind === "image" ? id : null;
    }),
  );
  return ok.filter((x): x is string => x !== null);
}

export const writeSlides = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as ImageSlideshowConfig;
    const topic = (config.prompt ?? "").trim();
    if (!topic) throw new Error("Say what the slideshow should be about.");

    const source: ImageSource = parseImageSource(config.images);
    const style = templateById(styleFor(source));
    const count = slideCountFor(source, style.slideCount);

    // The photos, and -- for a set -- what each shows, so the writer can match them.
    let setPhotos: { id: Id<"stockImages">; description: string }[] = [];
    let uploads: string[] = [];
    if (source.kind === "set") {
      setPhotos = await ctx.runQuery(internal.imageSets.forSet, { set: source.set.id });
      if (!setPhotos.length) {
        throw new Error(
          `The "${source.set.name}" image set has no photos yet. Pick another set, upload your own, or seed it (npx convex run imageSets:seed).`,
        );
      }
    } else {
      uploads = await ownImages(ctx, clientId, source.assetIds);
      if (!uploads.length) throw new Error("None of the chosen images could be found. Pick them again.");
    }

    const photoBrief = setPhotos.length
      ? `\n\nPhotos to choose from (the "${source.kind === "set" ? source.set.name : ""}" set), by number:\n` +
        setPhotos.map((p, i) => `${i + 1}. ${p.description}`).join("\n")
      : "\n\nThe photos are the person's own, one per slide, already in order -- write each slide's words without describing the photo.";

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.05 });
    const call = await callTool(
      WRITER_SYSTEM,
      `Style: ${style.name}.\n${style.voice}\n\nWrite exactly ${count} slides.\n\n` +
        `What the slideshow is about:\n${topic}` +
        (await businessContext(
          ctx,
          clientId,
          config.mentionBusiness,
          "Mention the business by name on one slide, the way a user would.",
        )) +
        photoBrief,
      writerTool(count, setPhotos.length) as never,
    );
    const drafted = slidesFrom(call.value).slice(0, count);
    if (drafted.length < Math.min(3, count)) {
      throw new Error(`model returned ${drafted.length} usable slide(s)`);
    }

    // Set photos become the client's own assets (shared bytes, no copy).
    let imageIds: string[];
    if (setPhotos.length) {
      const picks = assignPhotos(
        drafted.map((d) => d.photo),
        setPhotos.length,
      );
      const adopted = await ctx.runMutation(internal.imageSets.useMany, {
        clientId,
        imageIds: picks.map((i) => setPhotos[i].id),
      });
      imageIds = adopted;
    } else {
      imageIds = drafted.map((_, i) => uploads[i % uploads.length]);
    }
    const slides: Written[] = drafted.map((d, i) => ({
      heading: d.heading,
      body: d.body,
      imagePrompt: d.imagePrompt,
      imageAssetId: imageIds[i] ?? null,
    }));

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd: llmCost(call),
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: { slides, style: style.id },
    });
    return null;
  },
});

function writtenOf(job: Doc<"jobs">): { slides: Written[]; style?: string } {
  const out = job.steps.find((s) => s.id === "copy")?.output as
    | { slides?: Written[]; style?: string }
    | undefined;
  return { slides: out?.slides ?? [], style: out?.style };
}

// ---------------------------------------------------------------- the editor gate

/** Signed URLs for a deck's own assets, owner-checked; anything else is left out. */
async function urlsForDeck(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const asset = await ctx.runQuery(internal.assets.getInternal, { assetId: id as Id<"assets"> });
      if (!asset || asset.clientId !== clientId || asset.kind !== "image") return;
      const url = await ctx.storage.getUrl(asset.storageId);
      if (url) out[id] = url;
    }),
  );
  return out;
}

/**
 * Parks the run at the editor with a starting deck: the style's layout around
 * the words and photos P1 chose -- or, for "Edit slides again", the deck the
 * last export was made from. The URLs are for the first paint only; the
 * export re-resolves every asset itself.
 */
export const openEditor = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "edit", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as ImageSlideshowConfig;

    let deck;
    if (config.deck) {
      deck = sanitizeDeck(config.deck);
    } else {
      const written = writtenOf(job);
      const style = templateById(written.style ?? styleFor(parseImageSource(config.images)));
      deck = buildDeck(style, written.slides);
    }
    if (!deck.slides.length) throw new Error("There are no slides to edit.");

    const urls = await urlsForDeck(ctx, clientId, deckAssetIds(deck));
    await ctx.runMutation(internal.jobs.setAwaitingApproval, {
      jobId,
      stepId: "edit",
      output: { deck, urls },
    });
    return null;
  },
});

/**
 * The client, from an action's auth -- the pattern wallOfText.rewrite uses,
 * since an action has no db to hand to `requireClient`.
 */
async function clientOf(ctx: ActionCtx): Promise<Doc<"clients">> {
  return requireClientForAction(ctx);
}

/**
 * The editor's "Generate" tab -- for Swap Image, Add Images and Add Slide when
 * nothing in the sets fits. One photo, kept in the client's library and handed
 * back to the browser; nothing is written onto the job, because Save carries
 * whatever deck is on screen.
 */
export const generateImage = action({
  args: { jobId: v.id("jobs"), prompt: v.string(), ratio: v.optional(v.string()) },
  handler: async (ctx, { jobId, prompt, ratio }): Promise<{ assetId: string; url: string }> => {
    const client = await clientOf(ctx);
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job || job.clientId !== client._id || job.formatId !== "image-slideshow") {
      throw new Error("job not found");
    }
    if (job.status !== "awaiting_approval") {
      throw new Error("Images can only be generated while the slideshow is being edited.");
    }
    const brief = prompt.trim().slice(0, 800);
    if (!brief) throw new Error("Describe the image you want.");
    await enforceRateLimit(ctx, "slideImage", client._id);
    await enforceDailyImageCap(ctx, client._id);
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId: client._id,
      aboutToSpendUsd: IMAGE_PRICE * 1.2,
    });

    const r = ratioOf(ratio);
    const frame = frameOf(r);
    const result = (await submitWithContentPolicyFallback(
      IMAGE_MODEL,
      (p) => ({ prompt: p, aspect_ratio: r, output_format: "jpeg", num_images: 1 }),
      `${brief}. ${GENERATED_LOOK}`,
      () => `A calm, atmospheric photo of an everyday scene. ${GENERATED_LOOK}`,
    )) as { images?: { url?: string }[] };
    const src = result.images?.[0]?.url;
    if (!src) throw new Error("no image returned");
    const res = await fetch(src);
    if (!res.ok) throw new Error(`failed to fetch the generated image: ${res.status}`);
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId: client._id,
      storageId,
      mimeType: blob.type.startsWith("image/") ? blob.type : "image/jpeg",
      bytes: blob.size,
      width: frame.width,
      height: frame.height,
    });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("could not read back the generated image");

    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      jobId,
      stepId: "edit",
      primitive: "P2",
      model: IMAGE_MODEL,
      units: 1,
      unitLabel: "images",
      costUsd: IMAGE_PRICE,
    });
    return { assetId, url };
  },
});

// ---------------------------------------------------------------- the export

/**
 * Every slide as an image, each screenshotted by the render service from the
 * page `slidePageHtml` builds and uploaded straight to storage -- ten JPEGs
 * would clear Convex's argument ceiling as base64.
 */
export const render = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "render", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const approved = job.steps.find((s) => s.id === "edit")?.output as { deck?: unknown } | undefined;
    const deck = sanitizeDeck(approved?.deck);
    if (!deck.slides.length) throw new Error("There are no slides to export.");

    const urls = await urlsForDeck(ctx, clientId, deckAssetIds(deck));
    const frame = frameOf(deck.ratio);
    const pages = deck.slides.map((slide) => slidePageHtml(deck, slide, urls));
    const uploadUrls = await Promise.all(pages.map(() => ctx.storage.generateUploadUrl()));

    const res = await fetch(`${renderServiceBase()}/render/image-pages`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        pages,
        width: frame.width,
        height: frame.height,
        format: "jpeg",
        uploadUrls,
      }),
    });
    if (res.status === 404) {
      throw new Error(
        "The render service is running old code that can't export slides. Restart it (cd ../render-service && npm start), or redeploy it, and save again.",
      );
    }
    if (!res.ok) throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    const out = (await res.json()) as {
      files: { storageId: Id<"_storage">; bytes: number; contentType: string }[];
    };
    if (out.files?.length !== pages.length) {
      throw new Error(`render service returned ${out.files?.length ?? 0} of ${pages.length} slides`);
    }

    const assetIds: Id<"assets">[] = [];
    for (const f of out.files) {
      assetIds.push(
        await ctx.runMutation(internal.assets.record, {
          clientId,
          producedByJobId: jobId,
          storageId: f.storageId,
          mimeType: f.contentType,
          bytes: f.bytes,
          width: frame.width,
          height: frame.height,
        }),
      );
    }

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "render",
      primitive: "P8",
      model: "chrome",
      units: pages.length,
      unitLabel: "slides",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      output: {
        files: pages.map((_, i) => ({ name: `slide-${String(i + 1).padStart(2, "0")}.jpg` })),
        deck,
      },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

// ---------------------------------------------------------------- Improve

/**
 * Improve runs on Claude Haiku 4.5, not the Sonnet the writer uses: it
 * rewrites a sentence or two into a clearer brief, which a small model does
 * well, at half the per-token price ($1 / $5 per 1M, fal's OpenRouter id).
 */
const IMPROVE_MODEL = "anthropic/claude-haiku-4.5";
const IMPROVE_INPUT_PER_1M = 1.0;
const IMPROVE_OUTPUT_PER_1M = 5.0;

const IMPROVE_SYSTEM = `You sharpen the topic a person typed for a photo slideshow, before it is
written. Say WHAT the slideshow is about -- never HOW it is formatted.

Keep their topic, intent and any specifics they gave; never change what the
post is about. Make it concrete: who it is for, the angle or promise, and the
key points or story beats. Two to four sentences, plain text, written as the
person's own instruction ("A slideshow about...").

The writing style you are shown is context for choosing a topic and angle
that suit it. Do not repeat or summarize it: slide counts, word counts,
casing, emoji and layout rules are applied separately and must not appear in
your brief. Invent no facts, numbers or claims about a business.

Example -- typed: "gym motivation". Good: "A slideshow about the three habits
that finally made me consistent at the gym after years of quitting in week
two: training at the same time every day, tracking every lift, and treating
rest days as part of the plan." Bad: "6 slides, lowercase, 20-45 words each,
start with a hook..."`;

const IMPROVE_TOOL = {
  name: "save_prompt",
  description: "Save the improved brief.",
  input_schema: {
    type: "object",
    properties: { prompt: { type: "string", description: "The improved brief, under 600 characters." } },
    required: ["prompt"],
  },
};

/**
 * The config panel's Improve button: the typed prompt, rewritten into a
 * sharper brief for the chosen images and the style they call for. Returned
 * to the browser, which decides whether to keep it -- nothing is saved.
 */
export const improvePrompt = action({
  args: {
    prompt: v.string(),
    images: v.optional(v.string()),
    mentionBusiness: v.optional(v.boolean()),
  },
  handler: async (ctx, { prompt, images, mentionBusiness }): Promise<{ prompt: string }> => {
    const client = await clientOf(ctx);
    await enforceRateLimit(ctx, "rewriteText", client._id);
    const source = parseImageSource(images);
    const style = templateById(styleFor(source));
    const count = slideCountFor(source, style.slideCount);
    const typed = prompt.trim().slice(0, 1000);

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId: client._id, aboutToSpendUsd: 0.01 });
    const call = await callTool(
      IMPROVE_SYSTEM,
      `Format: a ${count}-slide photo slideshow` +
        (source.kind === "set"
          ? ` over photos from a "${source.set.name}" image set.`
          : " over the person's own photos.") +
        `\nFor context only -- the style it will be written in (${style.name}):\n${style.voice}\n\n` +
        (typed
          ? `The topic as typed:\n${typed}`
          : "Nothing was typed yet: invent one strong, specific topic that suits these photos and this style, " +
            "and write it as the brief.") +
        (await businessContext(
          ctx,
          client._id,
          mentionBusiness,
          "The post will mention this business, so shape the brief around a topic its customers care about.",
        )),
      IMPROVE_TOOL as never,
      { model: IMPROVE_MODEL },
    );
    const improved = String((call.value as { prompt?: string })?.prompt ?? "").trim().slice(0, 600);
    if (!improved) throw new Error("Couldn't improve that -- try again.");

    await ctx.runMutation(internal.ledger.record, {
      clientId: client._id,
      stepId: "improve",
      primitive: "P1",
      model: IMPROVE_MODEL,
      units: call.inputTokens + call.outputTokens,
      unitLabel: "tokens",
      costUsd:
        (call.inputTokens / 1e6) * IMPROVE_INPUT_PER_1M + (call.outputTokens / 1e6) * IMPROVE_OUTPUT_PER_1M,
    });
    return { prompt: improved };
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.imageSlideshow.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
