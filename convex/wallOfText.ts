import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL } from "./lib/fal";

/**
 * Wall of Text: bold type on a plain ground.
 *
 * The cheapest format in the set to run -- one short LLM call, or none at all
 * when you write the line yourself, and a render that costs nothing. Which
 * makes it the one that proves the copy path is genuinely optional rather than
 * merely declared so.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      const planned = await step.runQuery(internal.jobs.plannedStepIds, {
        jobId: args.jobId,
      });
      if (planned.includes("copy")) {
        await step.runAction(internal.wallOfText.writeText, args, { retry: true });
      }
      await step.runAction(internal.wallOfText.render, args, { retry: true });
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

const WALL_SYSTEM = `You write a single short line of text designed to be read in
under two seconds on a phone screen, at large type, with nothing else on screen.

- One idea. If it needs the word "and", cut it.
- At most 140 characters. Shorter is almost always better.
- A bold claim, a specific number, or a sharp question. Never a title.
- No markdown, no emoji, no hashtags, no quotation marks around the whole line.
- Active voice, concrete nouns, short words.`;

const WALL_TOOL = {
  name: "save_wall_text",
  description: "Save the generated line.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "At most 140 characters." },
    },
    required: ["text"],
  },
};

const LLM_INPUT_PER_1M = 3.0;
const LLM_OUTPUT_PER_1M = 15.0;
const MAX_CHARS = 140;

export const writeText = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "copy",
      state: "running",
    });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as { prompt?: string };

    const brief = (config.prompt ?? "").trim();
    if (!brief) {
      throw new Error("Write the text yourself, or give a prompt to generate it from.");
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: 0.02,
    });

    const call = await callTool(WALL_SYSTEM, brief, WALL_TOOL as never);
    const text = String((call.value as { text?: string })?.text ?? "").trim();
    if (!text) throw new Error("model returned no text");

    // Same belt-and-braces as the carousel: the budget is stated in the prompt
    // and checked here, so an overflow is visible rather than clipped on screen.
    if (text.length > MAX_CHARS) {
      throw new Error(`text is ${text.length} chars, over the ${MAX_CHARS} limit`);
    }

    const costUsd =
      (call.inputTokens / 1e6) * LLM_INPUT_PER_1M +
      (call.outputTokens / 1e6) * LLM_OUTPUT_PER_1M;

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
      output: { text },
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

    const config = job.config as {
      text?: string;
      dimensions?: string;
      durationSec?: number;
      captionStyle?: string;
      backgroundColor?: string;
    };
    // Either P1 wrote it, or the user did and P1 never ran.
    const written = (job.steps.find((s) => s.id === "copy")?.output as
      | { text?: string }
      | undefined)?.text;
    const text = (written ?? config.text ?? "").trim();
    if (!text) throw new Error("no text to render");

    const res = await fetch(`${base}/render/wall-of-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        dimensions: config.dimensions ?? "9:16",
        durationSec: config.durationSec ?? 5,
        captionStyle: config.captionStyle ?? "Headline",
        backgroundColor: config.backgroundColor ?? "#111111",
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
    const id = await workflow.start(ctx, internal.wallOfText.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
