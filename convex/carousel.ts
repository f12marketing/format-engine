import { v } from "convex/values";
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { callTool, LLM_MODEL } from "./lib/fal";
import { enforceRateLimit } from "./lib/rateLimit";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import {
  CAROUSEL_LIMITS,
  CAROUSEL_SYSTEM,
  CAROUSEL_TOOL,
  carouselSlides,
  carouselUserPrompt,
  type CarouselSlide,
} from "./lib/carouselPrompt";
import { CAROUSEL_TEMPLATE_IDS, DEFAULT_CAROUSEL_TEMPLATE } from "./lib/carouselTemplates";
import { businessContext } from "./lib/businessContext";

export const workflow = new WorkflowManager(components.workflow);

/** Anthropic list rates. fal may add margin, so treat these as a floor. */
const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;

/**
 * Phase 0's whole pipeline: write the deck, then render it.
 *
 * Two steps, and the workflow guarantees that a server restart between them
 * doesn't lose the paid one.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      // The job's step list is the plan: the caller already filtered the
      // format's pipeline through its declared conditions, so a hand-written
      // deck arrives with no "copy" step and the paid call is skipped. Running
      // the pipeline the format declares rather than a hardcoded pair is what
      // keeps the declaration honest.
      const planned = await step.runQuery(internal.jobs.plannedStepIds, {
        jobId: args.jobId,
      });

      if (planned.includes("copy")) {
        await step.runAction(internal.carousel.writeDeck, args, { retry: true });
      }
      await step.runAction(internal.carousel.renderDeck, args, { retry: true });
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
 * P1. The only paid call in the entire format -- about two to three cents.
 *
 * Retries once on an empty deck. The old app shipped a bug where the retry
 * guard and the acceptance guard disagreed about whether `slides` had arrived
 * as an array or a JSON string, so an empty deck sailed through both. Both
 * checks go through carouselSlides() here for exactly that reason.
 */
export const writeDeck = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const config = job.config as { logline?: string; slideCount?: number; mentionBusiness?: boolean };
    const logline = (config.logline ?? "").trim();
    const slideCount = config.slideCount ?? 7;
    if (!logline) throw new Error("A logline or script is required.");

    // Checked before the call, never after -- afterwards the money is gone.
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: 0.1, // generous ceiling for one deck
    });

    const business = await businessContext(
      ctx,
      clientId,
      config.mentionBusiness,
      "Where it fits the deck, work the business in by name -- a slide's example, the closing slide -- never as a sales pitch.",
    );

    let slides: CarouselSlide[] = [];
    let result: unknown;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const call = await callTool(
        CAROUSEL_SYSTEM,
        carouselUserPrompt(logline, slideCount) + business,
        CAROUSEL_TOOL as never,
      );
      inputTokens += call.inputTokens;
      outputTokens += call.outputTokens;
      result = call.value;
      slides = carouselSlides(call.value);
      if (slides.length >= 3) break;
      console.warn(`carousel attempt ${attempt} returned ${slides.length} slides`);
    }

    if (slides.length < 3) {
      throw new Error(`model returned only ${slides.length} slide(s) -- need at least 3`);
    }

    // Budgets are stated in the prompt AND re-checked here, so an overflow is a
    // visible failure rather than copy silently running past a template edge.
    const over = slides.flatMap((s, i) =>
      (Object.keys(CAROUSEL_LIMITS) as (keyof typeof CAROUSEL_LIMITS)[])
        .filter((f) => (s[f] ?? "").length > CAROUSEL_LIMITS[f])
        .map((f) => `slide ${i + 1} ${f} is ${(s[f] ?? "").length} chars`),
    );
    if (over.length) {
      throw new Error(`copy exceeded template budgets: ${over.join("; ")}`);
    }

    const costUsd =
      (inputTokens / 1e6) * LLM_INPUT_PER_1M + (outputTokens / 1e6) * LLM_OUTPUT_PER_1M;

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "copy",
      primitive: "P1",
      model: LLM_MODEL,
      units: inputTokens + outputTokens,
      unitLabel: "tokens",
      costUsd,
    });

    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "done",
      output: result,
    });
    return null;
  },
});

/**
 * P8. Rasterising a slide needs a real browser, which a Convex action is not,
 * so this hands off to the render service -- the first Railway endpoint, and
 * the old app's export_carousel.mjs with an HTTP wrapper around it.
 *
 * Free at the margin: it runs on hardware you already pay for, which is the
 * whole reason the render service is the highest-leverage thing to get right.
 */
export const renderDeck = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as {
      template?: string;
      aspectRatio?: string;
      deck?: { slides?: unknown; caption?: string; hashtags?: string[] };
    };
    // Either P1 wrote it, or the caller supplied one and P1 never ran.
    const copyStep = job.steps.find((s) => s.id === "copy");
    const deck =
      (copyStep?.output as
        | { slides?: unknown; caption?: string; hashtags?: string[] }
        | undefined) ?? config.deck;

    const res = await fetch(`${base}/render/carousel`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        jobId,
        slides: carouselSlides(deck),
        caption: deck?.caption ?? "",
        hashtags: deck?.hashtags ?? [],
        template: config.template ?? DEFAULT_CAROUSEL_TEMPLATE,
        aspectRatio: config.aspectRatio ?? "4:5",
      }),
    });
    if (!res.ok) {
      throw new Error(`render service failed: ${res.status} ${await res.text()}`);
    }

    const out = (await res.json()) as {
      files: { name: string; contentType: string; base64: string }[];
    };

    /**
     * Store the bytes, not just a note that they existed.
     *
     * The render service hands back base64 because it is stateless -- it does
     * not know where the deliverable should live. Persisting here, and pointing
     * each asset at the job that produced it, is what makes the output
     * downloadable and survivable.
     */
    // Delegated to a "use node" action -- see nodeStorage.ts. The default
    // action runtime's 64MB heap ceiling is a real limit a per-character
    // atob() decode can cross; this was found on Video Animation's stitched
    // output and applies here too as outputs grow.
    const assetIds = await ctx.runAction(internal.lib.nodeStorage.storeRenderedFiles, {
      clientId,
      jobId,
      files: out.files,
    });

    // Recorded at zero so the run's line items stay complete: a reader should
    // see that rendering happened and cost nothing, not that it is missing.
    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "render",
      primitive: "P8",
      model: "headless-chrome",
      units: carouselSlides(deck).length,
      unitLabel: "slides",
      costUsd: 0,
    });

    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "render",
      state: "done",
      // Names only: keeping base64 in the job row would bloat every read of it.
      output: { files: out.files.map((f) => ({ name: f.name })) },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds });
    return null;
  },
});

/**
 * Re-render a finished deck with hand-edited slide text and/or another template.
 *
 * Same shape as a remix: a NEW job whose "copy" step is frozen at done (holding
 * the edited deck) and whose render step is pending, so the workflow skips the
 * paid call and only rasterises again -- free. The original job and the assets
 * it produced are left alone, which matters because a scheduled post may
 * already point at those PNGs.
 *
 * Only the text fields are editable. `slide_id` and `role` are carried over
 * from the source by position, so the slide count cannot change here -- adding
 * or dropping a slide is a regenerate, not an edit. The template is safe to
 * change after the copy is written because every template is built to hold the
 * same limits.
 */
export const rerenderEdited = mutation({
  args: {
    jobId: v.id("jobs"),
    slides: v.array(
      v.object({
        kicker: v.string(),
        headline: v.string(),
        body: v.string(),
        swipe_cue: v.string(),
      }),
    ),
    /** Omitted keeps the source job's template. */
    template: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, slides, template }): Promise<Id<"jobs">> => {
    const client = await requireClient(ctx);
    await enforceRateLimit(ctx, "generateJob", client._id);

    const source = await ctx.db.get(jobId);
    if (!source || source.clientId !== client._id || source.formatId !== "carousel") {
      throw new Error("job not found");
    }
    if (source.status !== "done") {
      throw new Error("Only a finished carousel can be re-rendered.");
    }

    type Deck = { slides?: unknown; caption?: string; hashtags?: string[] };
    if (template !== undefined && !CAROUSEL_TEMPLATE_IDS.includes(template)) {
      throw new Error(`Unknown template "${template}".`);
    }

    const config = source.config as { deck?: Deck; template?: string };
    // Either P1 wrote the deck, or the caller supplied one and P1 never ran.
    const hasCopyStep = source.steps.some((s) => s.id === "copy");
    const deck = (source.steps.find((s) => s.id === "copy")?.output as Deck | undefined) ?? config.deck;
    const original = carouselSlides(deck);

    if (slides.length !== original.length) {
      throw new Error(`Expected ${original.length} slides, got ${slides.length}.`);
    }

    const edited: CarouselSlide[] = original.map((o, i) => ({
      ...o,
      kicker: slides[i].kicker.trim(),
      headline: slides[i].headline.trim(),
      body: slides[i].body.trim(),
      swipe_cue: slides[i].swipe_cue.trim(),
    }));

    // The same budgets writeDeck enforces: every template is designed to hold
    // them, so copy typed past a limit would overflow the slide it lands on.
    const problems = edited.flatMap((s, i) => {
      const out: string[] = [];
      if (!s.headline) out.push(`slide ${i + 1} needs a headline`);
      for (const f of Object.keys(CAROUSEL_LIMITS) as (keyof typeof CAROUSEL_LIMITS)[]) {
        if (s[f].length > CAROUSEL_LIMITS[f]) {
          out.push(`slide ${i + 1} ${f} is ${s[f].length} characters (max ${CAROUSEL_LIMITS[f]})`);
        }
      }
      return out;
    });
    if (problems.length) throw new Error(problems.join("; "));

    const editedDeck = { ...deck, slides: edited };

    const steps = source.steps.map((s) =>
      s.id === "copy"
        ? {
            id: s.id,
            primitive: s.primitive,
            label: s.label,
            state: "done" as const,
            output: editedDeck,
          }
        : { id: s.id, primitive: s.primitive, label: s.label, state: "pending" as const },
    );

    const newJobId = await ctx.db.insert("jobs", {
      clientId: client._id,
      formatId: source.formatId,
      config: {
        ...source.config,
        template: template ?? config.template ?? DEFAULT_CAROUSEL_TEMPLATE,
        // A hand-written deck lives in the config, since it has no copy step to
        // hold it; the render reads it from there.
        ...(hasCopyStep ? {} : { deck: editedDeck }),
      },
      status: "running",
      steps,
      costUsd: 0,
      remixedFromJobId: jobId,
    });

    await ctx.runMutation(internal.carousel.start, { jobId: newJobId, clientId: client._id });
    return newJobId;
  },
});

/** Kicks the workflow off. Called by the Generate button. */
export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.carousel.run, args);
    await ctx.db.patch(args.jobId as Id<"jobs">, { workflowId: id });
    return id;
  },
});
