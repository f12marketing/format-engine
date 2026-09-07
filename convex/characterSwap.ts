import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { workflow } from "./carousel";
import { submitAndPoll, submitWithContentPolicyFallback, callVisionTool } from "./lib/fal";

/**
 * Character Swap: swap the on-screen character in an uploaded video for a
 * reference photo, via Wan-2.2 Animate -- confirmed live against fal's own
 * API docs, not ported, since neither the old app nor this project's earlier
 * planning had actually settled on a model. `decart/lucy-2-5`, named in
 * `estimate.ts`'s original placeholder rate, turned out to be a real-time
 * WebRTC model with no batch API at all -- incompatible with "upload a video,
 * get a video back". Wan-Animate has two batch endpoints that map exactly
 * onto two of this format's three scene-control modes:
 *
 *  - "Video"  -> animate/replace: keeps the clip's own background and
 *    motion, swaps only the character.
 *  - "Image"  -> animate/move: applies the clip's motion to the character
 *    image, whose OWN background becomes the output's background.
 *  - "Recreate" -> no matching endpoint exists, so it's composed from two
 *    calls already used elsewhere in this app: the clip's first frame is
 *    extracted, the character is composited into THAT frame with
 *    qwen-image-3/edit (Product Spokesperson's own move), and the result is
 *    fed into animate/move -- background comes from the clip's first frame,
 *    not the character photo, which is what "best for a still background"
 *    in the spec's own help text is describing.
 *
 * The ledger's `reverse` mutation exists specifically for this format's own
 * spec rule -- "if it isn't swapped, don't charge for it" -- so `verify`
 * checks a frame of the output against the reference photo with a
 * vision-capable tool call and reverses every row this job charged if it
 * didn't visibly take.
 */
export const run = workflow
  .define({
    args: { jobId: v.id("jobs"), clientId: v.id("clients") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runAction(internal.characterSwap.swap, args, { retry: true });

      const planned = await step.runQuery(internal.jobs.plannedStepIds, { jobId: args.jobId });
      if (planned.includes("voice")) {
        await step.runAction(internal.characterSwap.convertVoice, args, { retry: true });
      }

      await step.runAction(internal.characterSwap.verify, args, { retry: true });
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

/**
 * Keyed by model so a future endpoint swap can't silently bill at the old
 * one's rate. Both Wan-Animate endpoints are $0.04/sec at the 480p tier they
 * default to ($0.06 at 580p, $0.08 at 720p).
 */
const SWAP_PRICE_PER_SEC: Record<string, number> = {
  "fal-ai/wan/v2.2-14b/animate/replace": 0.04,
  "fal-ai/wan/v2.2-14b/animate/move": 0.04,
};
// fal-ai/elevenlabs/voice-changer, $0.30/minute.
const VOICE_CHANGE_PRICE_PER_SEC = 0.005;
// alibaba/qwen-image-3/edit at 1K -- only spent in Recreate mode, for the extra
// first-frame composite that mode alone needs.
const COMPOSITE_PRICE_PER_UNIT = 0.04;

function renderServiceBase(): string {
  const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
  if (!base) throw new Error("RENDER_SERVICE_URL is not set on the deployment.");
  return base;
}

async function resolveAssetUrl(ctx: ActionCtx, assetId: Id<"assets">): Promise<string> {
  const asset = await ctx.runQuery(internal.assets.getInternal, { assetId });
  if (!asset) throw new Error("Referenced upload could not be found.");
  const url = await ctx.storage.getUrl(asset.storageId);
  if (!url) throw new Error("Could not read the uploaded file.");
  return url;
}

interface SwapConfig {
  sourceVideo?: Id<"assets">;
  characterImage?: Id<"assets">;
  sceneControl?: "Video" | "Image" | "Recreate";
  audio?: "Strip the audio" | "Keep the original sound" | "Convert the voice to the character";
}

/** P6. The character swap itself, branching on scene-control mode. */
export const swap = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "swap", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SwapConfig;
    if (!config.sourceVideo) throw new Error("A source video is required.");
    if (!config.characterImage) throw new Error("A character image is required.");

    const [sourceVideoUrl, characterImageUrl] = await Promise.all([
      resolveAssetUrl(ctx, config.sourceVideo),
      resolveAssetUrl(ctx, config.characterImage),
    ]);

    const base = renderServiceBase();
    const inspectRes = await fetch(`${base}/inspect/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: sourceVideoUrl }),
    });
    if (!inspectRes.ok) throw new Error(`could not inspect the source video: ${inspectRes.status}`);
    const inspected = (await inspectRes.json()) as { durationSec: number; hasAudio: boolean };
    const durationSec = Math.max(1, Math.round(inspected.durationSec || 0));
    if (!inspected.durationSec) throw new Error("Could not read the source video's duration.");

    const sceneControl = config.sceneControl ?? "Image";
    /**
     * fal-ai/wan-motion was tried here and rejected on measured evidence, not
     * on paper: it is the better model (same Wan-Animate family, plus pose
     * retargeting for mismatched builds, and cheaper at 720p), and its schema
     * is a drop-in. But a 10-second driving clip took ~12 minutes to come
     * back, against animate/move's ~5 for the identical input. That is past
     * this step's own 8-minute budget AND past Convex's hard 10-minute action
     * ceiling, so adopting it would trade a working step for one that times
     * out and re-bills on retry. Revisit if fal speeds it up.
     */
    const model =
      sceneControl === "Video"
        ? "fal-ai/wan/v2.2-14b/animate/replace"
        : "fal-ai/wan/v2.2-14b/animate/move";
    const swapPricePerSec = SWAP_PRICE_PER_SEC[model];

    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: durationSec * swapPricePerSec + COMPOSITE_PRICE_PER_UNIT * 1.2,
    });

    const ledgerIds: Id<"spend_ledger">[] = [];
    let animateImageUrl = characterImageUrl;

    if (sceneControl === "Recreate") {
      const frameRes = await fetch(`${base}/frame/first`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: sourceVideoUrl }),
      });
      if (!frameRes.ok) throw new Error(`could not extract the first frame: ${frameRes.status}`);
      const { base64: frameB64 } = (await frameRes.json()) as { base64: string };
      const frameBytes = Uint8Array.from(atob(frameB64), (c) => c.charCodeAt(0));
      const frameStorageId = await ctx.storage.store(
        new Blob([frameBytes as unknown as BlobPart], { type: "image/png" }),
      );
      const frameUrl = await ctx.storage.getUrl(frameStorageId);
      if (!frameUrl) throw new Error("could not read back the extracted frame");

      const wrap = (body: string) =>
        `@image1 is the clip's own first frame. @image2 is the character to place into it. ${body} ` +
        "Keep @image1's background, lighting and composition exactly as it is. High quality, no text.";

      const buildInput = (prompt: string) => ({
        prompt,
        image_urls: [frameUrl, characterImageUrl],
        num_images: 1,
      });
      const compositeResult = (await submitWithContentPolicyFallback(
        "alibaba/qwen-image-3/edit",
        buildInput,
        wrap("Replace the person in the frame with the character, matching their original pose."),
        () => wrap("Place the character naturally into the frame."),
      )) as { images?: { url?: string }[] };
      const compositedUrl = compositeResult.images?.[0]?.url;
      if (!compositedUrl) throw new Error("no recreated frame returned");

      const imgRes = await fetch(compositedUrl);
      if (!imgRes.ok) throw new Error(`failed to fetch recreated frame: ${imgRes.status}`);
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/png" }));
      const storedUrl = await ctx.storage.getUrl(storageId);
      if (!storedUrl) throw new Error("could not read back the recreated frame");
      animateImageUrl = storedUrl;

      ledgerIds.push(
        await ctx.runMutation(internal.ledger.record, {
          clientId,
          jobId,
          stepId: "swap",
          primitive: "P2",
          model: "alibaba/qwen-image-3/edit",
          units: 1,
          unitLabel: "images",
          costUsd: COMPOSITE_PRICE_PER_UNIT,
        }),
      );
    }

    const result = (await submitAndPoll(
      model,
      { video_url: sourceVideoUrl, image_url: animateImageUrl },
      { timeoutMs: 8 * 60_000 },
    )) as { video?: { url?: string } };
    const videoUrl = result.video?.url;
    if (!videoUrl) throw new Error("no swapped video returned");

    // Persisted rather than kept as fal's own URL -- verify (and voice, and a
    // future remix) all read this output well after fal's result URL is
    // guaranteed to stay fetchable.
    const vidRes = await fetch(videoUrl);
    if (!vidRes.ok) throw new Error(`failed to fetch swapped video: ${vidRes.status}`);
    const vidBytes = new Uint8Array(await vidRes.arrayBuffer());
    const storageId = await ctx.storage.store(new Blob([vidBytes], { type: "video/mp4" }));
    const storedVideoUrl = await ctx.storage.getUrl(storageId);
    if (!storedVideoUrl) throw new Error("could not read back the swapped video");

    ledgerIds.push(
      await ctx.runMutation(internal.ledger.record, {
        clientId,
        jobId,
        stepId: "swap",
        primitive: "P6",
        model,
        units: durationSec,
        unitLabel: "seconds",
        costUsd: durationSec * swapPricePerSec,
      }),
    );
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "swap",
      state: "done",
      output: {
        videoUrl: storedVideoUrl,
        durationSec,
        hasAudio: inspected.hasAudio,
        ledgerIds,
      },
    });
    return null;
  },
});

/** P4, conditional on `audio === "Convert the voice to the character"`. */
export const convertVoice = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "voice", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SwapConfig;
    const swapOut = job.steps.find((s) => s.id === "swap")?.output as
      | { durationSec?: number; hasAudio?: boolean }
      | undefined;
    if (!swapOut) throw new Error("the swap has not run yet");

    if (!swapOut.hasAudio) {
      // Nothing to convert. Not an error -- the source genuinely has no
      // voice to change, so this is a free no-op rather than a guess.
      await ctx.runMutation(internal.jobs.patchStep, {
        jobId,
        stepId: "voice",
        state: "done",
        output: { audioUrl: null, note: "The source video has no audio to convert." },
      });
      return null;
    }
    if (!config.sourceVideo) throw new Error("A source video is required.");
    const sourceVideoUrl = await resolveAssetUrl(ctx, config.sourceVideo);

    const base = renderServiceBase();
    const audioRes = await fetch(`${base}/extract/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: sourceVideoUrl }),
    });
    if (!audioRes.ok) throw new Error(`could not extract the source audio: ${audioRes.status}`);
    const { base64: audioB64 } = (await audioRes.json()) as { base64: string };
    const audioBytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
    const audioStorageId = await ctx.storage.store(
      new Blob([audioBytes as unknown as BlobPart], { type: "audio/mpeg" }),
    );
    const extractedAudioUrl = await ctx.storage.getUrl(audioStorageId);
    if (!extractedAudioUrl) throw new Error("could not read back the extracted audio");

    const durationSec = swapOut.durationSec ?? 0;
    await ctx.runMutation(internal.ledger.assertUnderCap, {
      clientId,
      aboutToSpendUsd: durationSec * VOICE_CHANGE_PRICE_PER_SEC,
    });

    const result = (await submitAndPoll("fal-ai/elevenlabs/voice-changer", {
      audio_url: extractedAudioUrl,
      voice: "Rachel",
    })) as { audio?: { url?: string } };
    const convertedUrl = result.audio?.url;
    if (!convertedUrl) throw new Error("no converted audio returned");

    const ledgerId = await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "voice",
      primitive: "P4",
      model: "fal-ai/elevenlabs/voice-changer",
      units: durationSec,
      unitLabel: "seconds",
      costUsd: durationSec * VOICE_CHANGE_PRICE_PER_SEC,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "voice",
      state: "done",
      output: { audioUrl: convertedUrl, ledgerId },
    });
    return null;
  },
});

const VERIFY_SYSTEM = `You compare two images to check whether a video character-swap tool succeeded.

The FIRST image is a frame taken from the tool's output video. The SECOND
image is the reference photo of the character that was supposed to replace
whoever was originally in the video.

Judge only whether the person/character visible in the first image is
recognisably the same person/character shown in the second image -- not
image quality, not whether the scene looks good, just identity.`;

const VERIFY_TOOL = {
  name: "report_swap_verification",
  description: "Report whether the character swap visibly took effect.",
  input_schema: {
    type: "object",
    properties: {
      swapped: {
        type: "boolean",
        description:
          "true if the output frame clearly shows the reference character; false if it still " +
          "shows a different person, or the result is too unclear to call it a match.",
      },
      reasoning: { type: "string" },
    },
    required: ["swapped", "reasoning"],
  },
};

/**
 * P7. Muxes the audio the config asks for onto the swap output, then checks
 * whether the swap actually took -- reversing every row this job charged if
 * it didn't, per the spec's own rule.
 */
export const verify = internalAction({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, { jobId, clientId }): Promise<null> => {
    await ctx.runMutation(internal.jobs.patchStep, { jobId, stepId: "verify", state: "running" });

    const job = await ctx.runMutation(internal.jobs.getInternal, { jobId });
    if (!job) throw new Error("unknown job");
    const config = job.config as SwapConfig;
    const swapOut = job.steps.find((s) => s.id === "swap")?.output as
      | { videoUrl?: string; durationSec?: number; hasAudio?: boolean; ledgerIds?: Id<"spend_ledger">[] }
      | undefined;
    if (!swapOut?.videoUrl) throw new Error("the swap has not run yet");
    const voiceOut = job.steps.find((s) => s.id === "voice")?.output as
      | { audioUrl?: string | null; ledgerId?: Id<"spend_ledger"> }
      | undefined;

    const audioChoice = config.audio ?? "Keep the original sound";
    let finalAudioUrl: string | null = null;
    if (audioChoice === "Convert the voice to the character") {
      finalAudioUrl = voiceOut?.audioUrl ?? null;
    } else if (audioChoice === "Keep the original sound" && swapOut.hasAudio && config.sourceVideo) {
      // ffmpeg reads whichever stream is actually there regardless of a
      // file's nominal type, so the source video itself works fine as an
      // "audio" input -- no separate extraction needed for this branch.
      finalAudioUrl = await resolveAssetUrl(ctx, config.sourceVideo);
    }

    const base = renderServiceBase();
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const renderRes = await fetch(`${base}/render/video-animation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shots: [
          {
            videoUrl: swapOut.videoUrl,
            audioUrl: finalAudioUrl,
            durationSec: swapOut.durationSec ?? 5,
            caption: null,
          },
        ],
        // FLAG: fixed at 9:16 rather than matching the source video's own
        // aspect ratio -- every other short-form format here assumes the
        // same default, and `inspectVideo` doesn't classify aspect ratio
        // into one of the renderer's presets.
        dimensions: "9:16",
        captionStyle: "Classic",
        uploadUrl,
      }),
    });
    if (!renderRes.ok) throw new Error(`render service failed: ${renderRes.status} ${await renderRes.text()}`);

    const out = (await renderRes.json()) as {
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

    // The vision check reads a frame straight off the swap output as a data
    // URI -- OpenRouter's image_url accepts one directly, and this frame is
    // never looked at again, so persisting it as an asset would be pure waste.
    const frameRes = await fetch(`${base}/frame/first`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: swapOut.videoUrl }),
    });
    if (!frameRes.ok) throw new Error(`could not extract a verification frame: ${frameRes.status}`);
    const { base64: outputFrameB64 } = (await frameRes.json()) as { base64: string };

    let swapped = true;
    if (config.characterImage) {
      const referenceUrl = await resolveAssetUrl(ctx, config.characterImage);
      const call = await callVisionTool(
        VERIFY_SYSTEM,
        "First image: the tool's output frame. Second image: the reference character.",
        [`data:image/png;base64,${outputFrameB64}`, referenceUrl],
        VERIFY_TOOL as never,
      );
      swapped = Boolean((call.value as { swapped?: boolean }).swapped);
    }

    if (!swapped) {
      const reversals = [...(swapOut.ledgerIds ?? []), ...(voiceOut?.ledgerId ? [voiceOut.ledgerId] : [])];
      for (const ledgerId of reversals) {
        await ctx.runMutation(internal.ledger.reverse, {
          ledgerId,
          reason: "verification: the character swap did not visibly take",
        });
      }
    }

    await ctx.runMutation(internal.ledger.record, {
      clientId,
      jobId,
      stepId: "verify",
      primitive: "P7",
      model: "ffmpeg+claude-vision",
      units: 1,
      unitLabel: "renders",
      costUsd: 0,
    });
    await ctx.runMutation(internal.jobs.patchStep, {
      jobId,
      stepId: "verify",
      state: "done",
      output: { files: [{ name: "output.mp4" }], swapConfirmed: swapped },
    });
    await ctx.runMutation(internal.jobs.setOutputs, { jobId, assetIds: [assetId] });
    return null;
  },
});

export const start = internalMutation({
  args: { jobId: v.id("jobs"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const id = await workflow.start(ctx, internal.characterSwap.run, args);
    await ctx.db.patch(args.jobId, { workflowId: id });
    return id;
  },
});
