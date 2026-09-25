"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getFormat } from "@/formats";
import { stepApplies } from "@/formats/types";
import { ApprovalGate } from "@/components/ApprovalGate";
import { RemixActions } from "@/components/RemixActions";
import { DeckEditor } from "@/components/DeckEditor";
import { PostComposer, type ComposerMedia } from "@/components/PostComposer";
import { WallStudio } from "@/components/wall/WallStudio";
import { HookCaptionStudio } from "@/components/wall/HookCaptionStudio";
import { MemeStudio } from "@/components/wall/MemeStudio";
import { SlideshowStudio } from "@/components/slideshow/SlideshowStudio";
import { carouselSlides } from "../../../../convex/lib/carouselPrompt";
import { DEFAULT_CAROUSEL_TEMPLATE } from "../../../../convex/lib/carouselTemplates";
import { hookCaptionDesign } from "../../../../convex/lib/wallOfTextDesign";

/** The formats whose gate is a full-page studio, and that gate's step. */
const STUDIO_STEP: Record<string, string> = {
  "wall-of-text": "style",
  "video-hook-demo": "style",
  "speaking-hook-demo": "style",
  "green-screen-meme": "style",
  "image-slideshow": "edit",
};

/**
 * The run, watched live.
 *
 * No polling and no refresh button: this is a Convex subscription, so each
 * step the workflow writes arrives here on its own. These runs take minutes,
 * and showing which of five steps you are on is the difference between
 * "working" and "broken".
 */
export function JobView({ jobId }: { jobId: string }) {
  const job = useQuery(api.jobs.get, { jobId: jobId as Id<"jobs"> });
  const assets = useQuery(api.assets.forJob, { jobId: jobId as Id<"jobs"> });
  const remixes = useQuery(api.jobs.remixesOf, { jobId: jobId as Id<"jobs"> });
  const [composing, setComposing] = useState(false);

  // Wall of Text's Schedule button saves, then lands here with ?schedule=1:
  // the composer opens by itself the moment the render is ready to attach.
  // Read once on the client; it is never rendered, so the server's `false`
  // can't cause a hydration mismatch.
  const [scheduleWhenDone, setScheduleWhenDone] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("schedule") === "1",
  );
  const ready = job?.status === "done" && Boolean(assets?.some((a) => a.url));
  const showComposer = composing || (scheduleWhenDone && ready);
  function closeComposer() {
    setComposing(false);
    if (scheduleWhenDone) {
      setScheduleWhenDone(false);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  if (job === undefined) {
    return <Shell><p className="text-sm text-muted">Loading…</p></Shell>;
  }
  if (job === null) {
    return <Shell><p className="text-sm text-muted">Job not found.</p></Shell>;
  }

  const format = getFormat(job.formatId);

  // Wall of Text parked at its studio gate gets the whole page: the studio is
  // the review, and it needs more room than the job column has. Video Hook &
  // Demo's caption editor (the same studio) and Image Slideshow's editor get
  // the same treatment.
  const studioStepId = STUDIO_STEP[job.formatId] ?? null;
  const studioStep =
    studioStepId && job.status === "awaiting_approval"
      ? job.steps.find((s) => s.id === studioStepId && s.state === "awaiting_approval")
      : undefined;
  if (studioStep) {
    const onSaved = (schedule: boolean) => schedule && setScheduleWhenDone(true);
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <Link href="/" className="font-mono text-xs text-muted hover:text-accent">
          ← Dashboard
        </Link>
        <div className="mt-3">
          {job.formatId === "image-slideshow" ? (
            <SlideshowStudio
              key={job._id}
              jobId={job._id}
              config={job.config as Record<string, never>}
              output={studioStep.output as never}
              onSaved={onSaved}
            />
          ) : job.formatId === "green-screen-meme" ? (
            <MemeStudio
              key={job._id}
              jobId={job._id}
              config={job.config as Record<string, never>}
              output={studioStep.output as never}
              onSaved={onSaved}
            />
          ) : job.formatId === "video-hook-demo" || job.formatId === "speaking-hook-demo" ? (
            <HookCaptionStudio
              key={job._id}
              formatId={job.formatId}
              jobId={job._id}
              config={job.config as Record<string, never>}
              output={studioStep.output as never}
              onSaved={onSaved}
            />
          ) : (
            <WallStudio
              key={job._id}
              jobId={job._id}
              config={job.config as Record<string, never>}
              output={studioStep.output as never}
              onSaved={onSaved}
            />
          )}
        </div>
      </main>
    );
  }
  // Written by the copy step, or supplied up front when that step was skipped
  // (a hand-written deck, or a re-render of edited copy).
  const deckSource =
    job.steps.find((s) => s.id === "copy")?.output ??
    (job.config as { deck?: unknown } | undefined)?.deck;
  const slides = job.formatId === "carousel" ? carouselSlides(deckSource) : [];
  const files = (job.steps.find((s) => s.id === "render")?.output as
    | { files?: { name: string }[] }
    | undefined)?.files;

  // Video first: a job that produced both a still and a clip posts the clip
  // alone, since none of these platforms accept several videos in one post.
  // Otherwise every rendered image goes together -- Slideshow, Carousel and
  // Custom can all produce more than one, and that's exactly what a carousel
  // post is for.
  const postableVideo = assets?.find((a) => a.url && a.kind === "video");
  const images = (assets ?? []).filter((a) => a.url && a.kind === "image");
  const postableAssets = postableVideo ? [postableVideo] : images;

  // A carousel is previewed live in the deck editor below, from the same
  // markup and stylesheets the render uses, so its PNGs get no second strip of
  // their own here -- they stay downloadable in the file list.
  const deckPreviewed = slides.length > 0;

  return (
    <Shell>
      <header className="flex items-center gap-3">
        <span className="text-2xl leading-none">{format?.icon ?? "•"}</span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {format?.name ?? job.formatId}
          </h1>
          <p className="font-mono text-xs text-muted">
            {job.status} · ${job.costUsd.toFixed(4)}
          </p>
          {job.remixedFromJobId && (
            <p className="mt-0.5 text-xs text-muted">
              Remixed from{" "}
              <Link
                href={`/jobs/${job.remixedFromJobId}`}
                className="underline hover:text-accent"
              >
                this job
              </Link>
            </p>
          )}
        </div>
      </header>

      {job.error && (
        <p className="mt-4 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent">
          {job.error}
        </p>
      )}

      {job.status === "awaiting_approval" &&
        (() => {
          const gated = job.steps.find((s) => s.state === "awaiting_approval");
          return gated ? (
            <ApprovalGate jobId={job._id} stepId={gated.id} output={gated.output} />
          ) : null;
        })()}

      {job.status === "done" && (
        <RemixActions jobId={job._id} formatId={job.formatId} steps={job.steps} />
      )}

      {job.status === "done" && job.formatId === "wall-of-text" && (
        <EditWallAgain job={job} />
      )}

      {job.status === "done" && job.formatId === "video-hook-demo" && (
        <EditCaptionsAgain job={job} />
      )}

      {job.status === "done" && job.formatId === "green-screen-meme" && <EditMemeAgain job={job} />}

      {job.status === "done" && job.formatId === "image-slideshow" && (
        <>
          {job.outputsPurgedAt && (
            <p className="mt-4 rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm text-muted">
              The exported images were removed after 90 days to save storage. Your slides are kept —
              use Edit slides again to export them again, free.
            </p>
          )}
          <EditSlidesAgain job={job} />
        </>
      )}

      {job.status === "failed" && job.formatId === "image-slideshow" && (
        <EditSlidesAgain job={job} failed />
      )}

      {/* Only once there's something to post: the composer's whole job is to
          attach finished files to an account. */}
      {job.status === "done" && postableAssets.length > 0 && (
        <button
          onClick={() => setComposing(true)}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {postableAssets.length > 1 ? `Schedule post (${postableAssets.length} images)` : "Schedule post"}
        </button>
      )}

      {showComposer && postableAssets.length > 0 && (
        <PostComposer
          jobId={job._id}
          media={postableAssets.map(
            (a): ComposerMedia => ({
              id: a.id,
              url: a.url,
              facts: {
                kind: a.kind,
                bytes: a.bytes,
                width: a.width,
                height: a.height,
                durationSec: a.durationSec,
              },
            }),
          )}
          onClose={closeComposer}
        />
      )}

      <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Steps
      </h2>
      <ol className="mt-2 space-y-2">
        {job.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-sub px-3 py-2"
          >
            <StepDot state={step.state} />
            <span className="flex-1 text-sm">{step.label}</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
              {step.primitive} · {step.state}
            </span>
          </li>
        ))}
      </ol>

      {slides.length > 0 && (
        <DeckEditor
          // A re-render lands on a new job, but keying on the id also resets
          // any half-typed edits if this component is reused across jobs.
          key={job._id}
          jobId={job._id}
          slides={slides}
          template={
            (job.config as { template?: string } | undefined)?.template ??
            DEFAULT_CAROUSEL_TEMPLATE
          }
          aspectRatio={(job.config as { aspectRatio?: string } | undefined)?.aspectRatio ?? "4:5"}
          editable={job.status === "done"}
        />
      )}

      {assets?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Output — {assets.length} files
          </h2>

          {/*
            Show the result, don't just link to it. A job page that lists
            "video · 37kB" makes you download a file to find out whether the
            run was any good.
          */}
          <div className="mt-2 space-y-3">
            {assets
              .filter((a) => a.url && a.kind === "video")
              .slice(0, 4)
              .map((a) => (
                <video
                  key={a.id}
                  src={a.url!}
                  controls
                  playsInline
                  className="w-full max-w-[280px] rounded-xl border border-line bg-black"
                />
              ))}

            {/* Several stills are a set to swipe through, not a column to
                scroll past -- and every one of them, not just the first few. */}
            {!deckPreviewed && images.length > 0 && (
              <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
                {images.map((a, i) => (
                  <li key={a.id} className="w-60 shrink-0 snap-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url!}
                      alt={`Rendered output ${i + 1}`}
                      className="w-full rounded-xl border border-line"
                      draggable={false}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ul className="mt-3 flex flex-wrap gap-2">
            {assets.map((a) =>
              a.url ? (
                <li key={a.id}>
                  <a
                    href={a.url}
                    download
                    className="block rounded-md border border-line bg-surface-sub px-2 py-1 font-mono text-xs hover:border-accent"
                  >
                    {a.kind} · {(a.bytes / 1024).toFixed(0)}kB
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </>
      ) : files?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Rendered
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <li
                key={f.name}
                className="rounded-md border border-line bg-surface-sub px-2 py-1 font-mono text-xs"
              >
                {f.name}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {remixes?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Remixed as
          </h2>
          <ul className="mt-2 space-y-2">
            {remixes.map((r) => (
              <li key={r._id}>
                <Link
                  href={`/jobs/${r._id}`}
                  className="flex items-center justify-between rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm hover:border-accent"
                >
                  <span>{r.status}</span>
                  <span className="font-mono text-xs text-muted">
                    ${r.costUsd.toFixed(3)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

    </Shell>
  );
}

/**
 * Reopens a finished Wall of Text in the studio with the design it was
 * rendered from -- a new job, so the video already made stays as it is. The
 * text travels inside the design, so the copy step is skipped.
 */
function EditWallAgain({
  job,
}: {
  job: { _id: Id<"jobs">; config: unknown; steps: { id: string; primitive: string; label: string; output?: unknown }[] };
}) {
  const router = useRouter();
  const generate = useMutation(api.run.generate);
  const [busy, setBusy] = useState(false);
  const design = (job.steps.find((s) => s.id === "render")?.output as { design?: unknown } | undefined)
    ?.design;
  if (!design) return null;

  // A clip this job filmed is one of the client's videos now: the reopened
  // job points at it, so editing the text again never pays to film again.
  const filmed = (job.steps.find((s) => s.id === "film")?.output as { assetId?: string } | undefined)
    ?.assetId;

  async function onClick() {
    setBusy(true);
    try {
      const jobId = await generate({
        formatId: "wall-of-text",
        config: {
          ...(job.config as object),
          design,
          ...(filmed ? { video: `video:${filmed}` } : {}),
        },
        steps: job.steps
          .filter((s) => !["copy", "scene", "film"].includes(s.id))
          .map((s) => ({ id: s.id, primitive: s.primitive, label: s.label })),
        remixedFromJobId: job._id,
      });
      router.push(`/jobs/${jobId}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-4 w-full rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
    >
      {busy ? "Opening the studio…" : "Edit text & style again"}
    </button>
  );
}

/**
 * Reopens a finished Video Hook & Demo in the caption studio, on the same
 * hook -- a new job, so the video already made stays as it is. The caption
 * travels inside the design, so nothing is written again; a hook this job
 * filmed is one of the client's videos now, so nothing is filmed again either.
 * A job from before the studio opens its caption in the default look, and one
 * made without captions opens with none, to add one.
 */
function EditCaptionsAgain({
  job,
}: {
  job: { _id: Id<"jobs">; config: unknown; steps: { id: string; output?: unknown }[] };
}) {
  const router = useRouter();
  const generate = useMutation(api.run.generate);
  const [busy, setBusy] = useState(false);
  const format = getFormat("video-hook-demo");
  if (!format) return null;

  const outputOf = (id: string) => job.steps.find((s) => s.id === id)?.output as Record<string, unknown> | undefined;
  const caption = typeof outputOf("copy")?.caption === "string" ? (outputOf("copy")!.caption as string) : "";
  const design = outputOf("stitch")?.design ?? hookCaptionDesign(caption);
  const hasCaption = Boolean(outputOf("stitch")?.design || caption);
  const filmed = outputOf("film")?.assetId;
  const config = job.config as Record<string, unknown>;

  async function onClick() {
    setBusy(true);
    try {
      // Jobs from before the hook popup kept their clip as a bare `trendingClip`.
      const hook =
        typeof filmed === "string"
          ? `video:${filmed}`
          : (config.hook ?? (config.trendingClip ? `clip:${String(config.trendingClip)}` : undefined));
      const next = { ...config, design, captions: true, hook };
      const jobId = await generate({
        formatId: "video-hook-demo",
        config: next,
        steps: format!.pipeline
          .filter((s) => stepApplies(s, next) && !["copy", "scene", "film"].includes(s.id))
          .map((s) => ({ id: s.id, primitive: s.primitive, label: s.label })),
        remixedFromJobId: job._id,
      });
      router.push(`/jobs/${jobId}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-4 w-full rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
    >
      {busy ? "Opening the editor…" : hasCaption ? "Edit captions again" : "Add captions"}
    </button>
  );
}

/**
 * Green Screen Meme's EditCaptionsAgain: reopens a finished video in the meme
 * studio with the design it was rendered from -- the meme where it was, the
 * caption as styled -- as a new job, so the video already made stays as it
 * is. Nothing is written again. Jobs from before the studio keyed a trending
 * clip rather than a meme, and have nothing to reopen.
 */
function EditMemeAgain({
  job,
}: {
  job: { _id: Id<"jobs">; config: unknown; steps: { id: string; output?: unknown }[] };
}) {
  const router = useRouter();
  const generate = useMutation(api.run.generate);
  const [busy, setBusy] = useState(false);
  const format = getFormat("green-screen-meme");
  const config = job.config as Record<string, unknown>;
  const design = (job.steps.find((s) => s.id === "render")?.output as { design?: unknown } | undefined)?.design;
  if (!format || !design || !config.meme) return null;

  async function onClick() {
    setBusy(true);
    try {
      const next = { ...config, design };
      const jobId = await generate({
        formatId: "green-screen-meme",
        config: next,
        steps: format!.pipeline
          .filter((s) => stepApplies(s, next) && s.id !== "copy")
          .map((s) => ({ id: s.id, primitive: s.primitive, label: s.label })),
        remixedFromJobId: job._id,
      });
      router.push(`/jobs/${jobId}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-4 w-full rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
    >
      {busy ? "Opening the editor…" : "Edit meme again"}
    </button>
  );
}

/**
 * Reopens a finished Image Slideshow in the editor with the deck it was
 * exported from -- a new job, so the images already made stay as they are.
 * The words and photos travel inside the deck, so nothing is written again.
 */
function EditSlidesAgain({
  job,
  failed = false,
}: {
  job: { _id: Id<"jobs">; config: unknown; steps: { id: string; primitive: string; label: string; output?: unknown }[] };
  /** The export failed: reopen the deck that was saved, so the edits aren't lost. */
  failed?: boolean;
}) {
  const router = useRouter();
  const generate = useMutation(api.run.generate);
  const [busy, setBusy] = useState(false);
  const deckOf = (id: string) => (job.steps.find((s) => s.id === id)?.output as { deck?: unknown } | undefined)?.deck;
  // A finished export records the deck it drew; a failed one never got that
  // far, but Save left the deck on the editor step.
  const deck = deckOf("render") ?? deckOf("edit");
  if (!deck) return null;

  async function onClick() {
    setBusy(true);
    try {
      const jobId = await generate({
        formatId: "image-slideshow",
        config: { ...(job.config as object), deck },
        steps: job.steps
          .filter((s) => s.id !== "copy")
          .map((s) => ({ id: s.id, primitive: s.primitive, label: s.label })),
        remixedFromJobId: job._id,
      });
      router.push(`/jobs/${jobId}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-4 w-full rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-60"
    >
      {busy ? "Opening the editor…" : failed ? "Open your slides and save again" : "Edit slides again"}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <Link href="/" className="font-mono text-xs text-muted hover:text-accent">
        ← Dashboard
      </Link>
      <div className="mt-3">{children}</div>
    </main>
  );
}

const DOT: Record<string, string> = {
  done: "bg-ok",
  running: "bg-warn animate-pulse",
  failed: "bg-accent",
  skipped: "bg-line-strong",
  pending: "bg-line-strong",
};

function StepDot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={`size-2.5 shrink-0 rounded-full ${DOT[state] ?? "bg-line-strong"}`}
    />
  );
}
