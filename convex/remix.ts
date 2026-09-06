import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireClient } from "./clients";
import { STARTERS, type RunnableFormatId } from "./starters";

/**
 * The two remix actions, built once against every format rather than per
 * format -- the plan's own words: "every finished job offers Remix and
 * Regenerate copy."
 *
 * The split is by primitive, which every step already carries:
 *   - P1 is copy.
 *   - P2-P6, P9, P10 are "visual" generation -- images, video, voice, swaps,
 *     the clip library, the avatar roster.
 *   - P7/P8 (render/typeset) always re-run: they're free, and the whole point
 *     is to recombine whatever changed.
 *
 * *Remix only* freezes the P1 steps and regenerates the visual ones.
 * *Regenerate copy only* does the reverse. A format with no visual step at
 * all (Carousel, Custom, Wall of Text -- copy and render, no generation in
 * between) makes "Remix only" a genuine no-op, exactly as the plan flagged:
 * there is nothing for it to regenerate, so the frontend should disable
 * rather than price it at zero.
 *
 * Video Animation is excluded below, not silently handled: its three gates
 * mean a regenerated story can produce a different shot COUNT, and reusing
 * old scene/clip/voice output built for the old shots would be wrong, not
 * just wasteful. Making that correct needs per-shot diffing this session
 * doesn't have time for -- a known gap, not an oversight.
 */
const COPY_PRIMITIVES = new Set(["P1"]);
const ALWAYS_RERUN_PRIMITIVES = new Set(["P7", "P8"]);
const GATED_FORMATS = new Set(["video-animation"]);

export const remix = mutation({
  args: {
    jobId: v.id("jobs"),
    action: v.union(v.literal("remixVisuals"), v.literal("regenerateCopy")),
  },
  handler: async (ctx, { jobId, action }): Promise<Id<"jobs">> => {
    const client = await requireClient(ctx);
    const source = await ctx.db.get(jobId);
    if (!source || source.clientId !== client._id) throw new Error("job not found");
    if (source.status !== "done") {
      throw new Error("Only a finished job can be remixed.");
    }
    if (GATED_FORMATS.has(source.formatId)) {
      throw new Error(
        `${source.formatId} doesn't support remix yet -- its approval gates mean ` +
          "a regenerated step could invalidate steps after it in ways this doesn't model.",
      );
    }

    const starter = STARTERS[source.formatId as RunnableFormatId];
    if (!starter) throw new Error(`${source.formatId} has no pipeline.`);

    // Freeze the steps this action keeps; leave everything else pending so
    // the workflow's own `plannedStepIds` check (already used to skip a
    // hand-written deck's copy step) skips them the same way.
    const keepDone = (primitive: string) =>
      action === "remixVisuals" ? COPY_PRIMITIVES.has(primitive) : !COPY_PRIMITIVES.has(primitive);

    const steps = source.steps.map((s) => {
      if (!ALWAYS_RERUN_PRIMITIVES.has(s.primitive) && keepDone(s.primitive)) {
        return {
          id: s.id,
          primitive: s.primitive,
          label: s.label,
          state: "done" as const,
          output: s.output,
        };
      }
      return { id: s.id, primitive: s.primitive, label: s.label, state: "pending" as const };
    });

    const newJobId = await ctx.db.insert("jobs", {
      clientId: client._id,
      formatId: source.formatId,
      // Same config as the source, frozen the same way a fresh job's is --
      // remix reruns the brief, it doesn't reopen the config panel.
      config: source.config,
      status: "running",
      steps,
      costUsd: 0,
      remixedFromJobId: jobId,
    });

    await ctx.runMutation(starter, { jobId: newJobId, clientId: client._id });
    return newJobId;
  },
});
