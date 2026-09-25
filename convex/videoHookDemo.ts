import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { workflow } from "./carousel";
import { callTool, LLM_MODEL, submitWithContentPolicyFallback } from "./lib/fal";
import { renderServiceBase, renderServiceHeaders } from "./lib/renderService";
import { businessContext } from "./lib/businessContext";
import { animateClip, clipModelFor, clipRate, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from "./lib/klingClip";
import { resolveRosterPersona } from "./lib/roster";
import { resolveAudioUrl } from "./lib/audioRef";
import { isClipRef, isVideoRef, resolveVideo } from "./lib/videoRef";

/**
 * Video Hook & Demo: a few seconds of hook, then a hard cut to the user's own
 * demo video, with a caption burned on.
 *
 * The hook comes from the hook popup, in one of two ways:
 *   - a finished clip: "clip:<id>" from the trending library, or
 *     "video:<assetId>" from My hooks. P9 just resolves it -- free, and
 *     ingestion into the shared `clips` table is a separate, standalone step
 *     (see `lib/clipIngest.ts`), so a run never waits on ScrapeCreators.
 *   - a person: P2 stages them in a casual front-camera selfie and P3 films
 *     a few seconds of them reacting, silently, to what's about to be shown
 *     -- kept in My hooks, so it can front the next demo too.
 *
 * Jobs made before the popup stored their clip as a bare `trendingClip` id,
 * which `hookRef` still reads.
 */
interface HookDemoConfig {
  hook?: string;
  trendingClip?: Id<"clips">;
  reaction?: string;
  setting?: string;
  demoVideo?: Id<"assets">;
  aspectRatio?: string;
  audio?: string | null;
}

/**
 * The reference ads' look, fixed rather than offered as settings: about four
 * seconds of hook, then the demo, with the caption in outlined text
 * mid-frame over the hook only.
 */
const HOOK_SECONDS = 4;
const CAPTION_STYLE = "Outline";

function hookRef(config: HookDemoConfig): string | undefined {
  return config.hook ?? (config.trendingClip ? `clip:${config.trendingClip}` : undefined);
}

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
      // Caption first: it fails on a missing brief, and should before a
      // reaction has been paid for.
      if (planned.includes("copy")) {
        await step.runAction(internal.videoHookDemo.writeCaption, args, { retry: true });
      }
      if (planned.includes("clip")) {
        await step.runAction(internal.videoHookDemo.fetchClip, args, { retry: true });
      }
      if (planned.includes("scene")) {
        await step.runAction(internal.videoHookDemo.stageReaction, args, { retry: true });
      }
      if (planned.includes("film")) {
        await step.runAction(internal.videoHookDemo.filmReaction, args, { retry: true });
      }
      await step.runAction(internal.videoHookDemo.stitch, args, { retry: true });
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

/** P9. Resolves the picked clip -- trending or one of My hooks -- to a fetchable URL. Free. */
export const fetchClip = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "clip", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const ref = hookRef(job.config as HookDemoConfig);
    if (!ref || !isVideoRef(ref)) throw new Error("No hook clip selected.");
    const { url, hookKind } = await resolveVideo(ctx, ref, clientId);

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "clip",
      primitive: "P9",
      model: isClipRef(ref) ? "clip-library" : "my-hooks",
      units: 1,
      unitLabel: "clips",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "clip",
      state: "done",
      output: { url, hookKind },
    });
    return null;
  },
});

// ---------------------------------------------------------------- filming a reaction

/** The popup's Reaction choices, as a face and a moment. */
const REACTIONS: Record<string, { face: string; motion: string }> = {
  Shocked: {
    face: "eyes wide and eyebrows raised, a hand drifting up toward their mouth in disbelief",
    motion: "slowly widens their eyes, raises their eyebrows and brings a hand up toward their mouth in disbelief",
  },
  "Mind-blown": {
    face: "jaw slightly dropped, staring into the lens like they just learned something unbelievable",
    motion: "lets their jaw drop, blinks, shakes their head slightly as if they can't believe it",
  },
  Laughing: {
    face: "mid-laugh, eyes creased, genuinely amused",
    motion: "breaks into a real laugh, shoulders shaking, glancing away then back at the lens",
  },
  "Side-eye": {
    face: "a skeptical side-eye at the lens, lips pressed together",
    motion: "gives the lens a long skeptical side-eye, then raises one eyebrow",
  },
  Excited: {
    face: "a huge excited grin, leaning toward the lens",
    motion: "leans in toward the lens with a growing excited grin, nodding quickly",
  },
  "Spilling a secret": {
    face: "leaning close to the lens with a conspiratorial look, like they're about to tell a secret",
    motion: "leans in close, glances over their shoulder, then back at the lens with a knowing look",
  },
};
const DEFAULT_REACTION = "Shocked";

/** Where they're filming. The references are cars, bedrooms and kitchens -- ordinary places. */
const SETTINGS: Record<string, string> = {
  Car: "sitting in the driver's seat of a parked car, daylight through the windscreen",
  Bedroom: "sitting on their bed in a lived-in bedroom, soft lamp light",
  Kitchen: "leaning on the counter in a home kitchen",
  Couch: "slumped on a couch in a living room",
  Desk: "sitting at a desk with a laptop in the background",
  "Walking outside": "walking along a quiet street, daylight",
};
const DEFAULT_SETTING = "Car";

const SCENE_MODEL = "alibaba/qwen-image-3/edit";
const SCENE_PRICE = 0.04;

/**
 * P2. The picked person, re-shot as the opening frame of a front-camera
 * selfie mid-reaction -- the same staging Wall of Text uses, because the
 * reference hooks are the same thing: nobody in them is lit or styled.
 */
export const stageReaction = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "scene", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as HookDemoConfig;
    const ref = hookRef(config);
    if (!ref || isVideoRef(ref)) throw new Error("There is nobody to film.");

    const person = await resolveRosterPersona(ctx, ref, { clientId, jobId });
    const reaction = REACTIONS[config.reaction ?? ""] ?? REACTIONS[DEFAULT_REACTION];
    const where = SETTINGS[config.setting ?? ""] ?? SETTINGS[DEFAULT_SETTING];

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: SCENE_PRICE * 1.2,
    });

    const wrap = (expression: string) =>
      `@image1 is a person (${person.description}). A vertical 9:16 front-camera selfie of them, ` +
      `phone held at arm's length, ${where}. Casual and unedited, like the first frame of a TikTok ` +
      "reaction: available light only, slight phone-camera grain, framed from the chest up with room " +
      `above the head, ${expression}. Keep their face and features exactly as in @image1. ` +
      "No text, no captions, no watermark, no phone UI.";

    const result = (await submitWithContentPolicyFallback(
      SCENE_MODEL,
      (prompt) => ({ prompt, image_urls: [person.imageUrl], num_images: 1 }),
      wrap(reaction.face),
      () => wrap("looking into the lens with a surprised expression"),
    )) as { images?: { url?: string }[] };
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("no selfie frame returned");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch the selfie frame: ${res.status}`);
    const storageId = await ctx.storage.store(await res.blob());
    const imageUrl = await ctx.storage.getUrl(storageId);
    if (!imageUrl) throw new Error("could not read back the selfie frame");

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "scene",
      primitive: "P2",
      model: SCENE_MODEL,
      units: 1,
      unitLabel: "images",
      costUsd: SCENE_PRICE,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "scene",
      state: "done",
      output: { imageUrl, scene: where },
    });
    return null;
  },
});

/** How long a filmed hook runs: the hook length, within what the clip model will make. */
const REACTION_SECONDS = Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, HOOK_SECONDS));

/**
 * P3. The frame, animated into the reaction itself. Silent -- the caption is
 * what they're reacting to, and a mouth moving with nothing to say reads as
 * broken. Kept as a "reaction" hook, so it shows up in My hooks.
 */
export const filmReaction = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "film", state: "running" });
    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as HookDemoConfig;
    const frame = (job.steps.find((s) => s.id === "scene")?.output as { imageUrl?: string } | undefined)
      ?.imageUrl;
    if (!frame) throw new Error("no selfie frame to film");

    const reaction = REACTIONS[config.reaction ?? ""] ?? REACTIONS[DEFAULT_REACTION];
    const seconds = REACTION_SECONDS;
    const model = clipModelFor(undefined);
    const costUsd = seconds * clipRate(model);
    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: costUsd * 1.1 });

    const clip = await animateClip({
      model,
      startImageUrl: frame,
      seconds,
      prompt:
        "Handheld front-camera selfie video, a genuine reaction. The person holds the phone at " +
        `arm's length with small, natural hand-held sway and ${reaction.motion}. Real, unposed facial ` +
        "expressions; they are not talking. Keep the face, the room and the light exactly as in the " +
        "opening frame, with no warping or morphing.",
      minimalPrompt: () =>
        "Subtle handheld camera sway and a natural facial reaction. Keep everything exactly as in " +
        "the opening frame.",
    });

    const res = await fetch(clip);
    if (!res.ok) throw new Error(`failed to fetch the filmed clip: ${res.status}`);
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    // The client's own hook (no producedByJobId): it lands in My hooks for
    // reuse, and isn't this job's deliverable, which is the stitched video.
    const assetId = await ctx.runMutation(internal.assets.record, {
      clientId,
      storageId,
      mimeType: "video/mp4",
      bytes: blob.size,
      durationSec: seconds,
      hookKind: "reaction",
    });

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "film",
      primitive: "P3",
      model,
      units: seconds,
      unitLabel: "seconds",
      costUsd,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "film",
      state: "done",
      output: { assetId, durationSec: seconds },
    });
    return null;
  },
});

export const clipRow = internalQuery({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => ctx.db.get(clipId),
});

const CAPTION_SYSTEM = `You write the on-screen caption (at most 100 characters) for a TikTok-style
"hook + demo" ad: a few seconds of a creator reacting to camera, then a hard
cut to a screen recording of the product.

The caption is what the creator is reacting TO, written in their voice, as if
they just discovered the product and can't believe it exists. It should read
like a real post, not an ad. Patterns that work:
- A generational or group callout: "I love [group] because WDYM someone made
  a [thing] that [does surprising thing]"
- Disbelief at a capability: "wait since WHEN could [product] do [thing]??"
- A bold, slightly unhinged claim: "[product] just ended [a whole category]"
- A relatable pain, then the twist: "me pretending I didn't just find an app
  that [solves the pain]"

- Casual, lowercase-leaning, with CAPS on the one or two words that carry the
  surprise. Question marks and "?!" are fine.
- No hashtags, no quotation marks, no markdown. At most one emoji.
- Say what the product actually does -- the demo that follows has to pay off
  the caption, so it must be specific and true to the brief.
- If told to mention a business, weave its name in naturally -- don't append it.`;

const CAPTION_TOOL = {
  name: "save_caption",
  description: "Save the generated hook caption.",
  input_schema: {
    type: "object",
    properties: {
      caption: { type: "string", description: "At most 100 characters." },
    },
    required: ["caption"],
  },
};

const LLM_INPUT_PER_1M = 2.0;
const LLM_OUTPUT_PER_1M = 10.0;
const MAX_CHARS = 100;

/**
 * P1. Only planned when Hook caption was left blank. With no prompt either,
 * the business profile is the brief; with neither, this fails loudly rather
 * than rendering a hook with nothing on it.
 */
export const writeCaption = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "copy", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as HookDemoConfig & { prompt?: string; mentionBusiness?: boolean };

    // A speaking hook from My hooks already has its caption: what it says.
    const ref = hookRef(config);
    if (ref?.startsWith("video:")) {
      const { hookLine } = await resolveVideo(ctx, ref, clientId);
      if (hookLine) {
        await ctx.runMutation(internal.jobs.patchStep, {
          jobId,
          stepId: "copy",
          state: "done",
          output: { caption: hookLine },
        });
        return null;
      }
    }

    const brief =
      (config.prompt ?? "").trim() ||
      (config.mentionBusiness ? "Write the hook for a demo of this business's product." : "");
    if (!brief) {
      throw new Error(
        "Give a prompt saying what the demo shows (or switch on Mention your business) so we can write the hook caption.",
      );
    }

    await ctx.runMutation(internal.ledger.assertUnderCap, { clientId, aboutToSpendUsd: 0.02 });

    const userPrompt = brief + (await businessContext(ctx, clientId, config.mentionBusiness));
    const call = await callTool(CAPTION_SYSTEM, userPrompt, CAPTION_TOOL as never);
    const caption = String((call.value as { caption?: string })?.caption ?? "").trim();
    if (!caption) throw new Error("model returned no caption");
    if (caption.length > MAX_CHARS) {
      throw new Error(`caption is ${caption.length} chars, over the ${MAX_CHARS} limit`);
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
      output: { caption },
    });
    return null;
  },
});

/** P7 + P8 in one hop -- same reasoning as Custom and Video Animation's merged stitch. */
export const stitch = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "stitch", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");

    const base = renderServiceBase();

    const config = job.config as HookDemoConfig;
    if (!config.demoVideo) throw new Error("A demo video upload is required.");

    // Filmed this run, or picked: either way one video, resolved the same way.
    const filmed = (job.steps.find((s) => s.id === "film")?.output as { assetId?: string } | undefined)
      ?.assetId;
    const picked = job.steps.find((s) => s.id === "clip")?.output as
      | { url?: string; hookKind?: string }
      | undefined;
    const hook = filmed
      ? await resolveVideo(ctx, `video:${filmed}`, clientId)
      : picked?.url
        ? { url: picked.url, hookKind: picked.hookKind }
        : null;
    if (!hook) throw new Error("The hook clip has not been fetched or filmed yet.");
    // A hook someone speaks in plays in full -- cutting it at the hook length
    // would cut them off mid-sentence -- and keeps its voice under any music.
    const speaks = hook.hookKind === "speaking";
    const audioUrl = await resolveAudioUrl(ctx, config.audio ?? null, clientId);

    const demoAsset = await ctx.runQuery(internal.assets.getInternal, {
      assetId: config.demoVideo,
    });
    if (!demoAsset) throw new Error("The demo video upload could not be found.");
    const demoUrl = await ctx.storage.getUrl(demoAsset.storageId);
    if (!demoUrl) throw new Error("The demo video upload could not be read.");

    const captionText =
      (job.steps.find((s) => s.id === "copy")?.output as { caption?: string } | undefined)?.caption ?? "";

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const res = await fetch(`${base}/render/video-hook-demo`, {
      method: "POST",
      headers: renderServiceHeaders(),
      body: JSON.stringify({
        hookUrl: hook.url,
        demoUrl,
        dimensions: config.aspectRatio ?? "9:16",
        captionText,
        captionStyle: CAPTION_STYLE,
        hookSeconds: speaks ? 0 : HOOK_SECONDS,
        captionOver: "hook",
        audioUrl,
        keepOriginal: speaks,
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
      stepId: "stitch",
      primitive: "P7",
      model: "ffmpeg",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "stitch",
      state: "done",
      output: { files: [{ name: "output.mp4" }] },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.videoHookDemo.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
