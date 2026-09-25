"use client";

import { useState } from "react";
import type { FormatDefinition } from "@/formats/types";
import { convexConfigured } from "@/app/ConvexClientProvider";
import { AuthorisedBoundary } from "./AuthorisedBoundary";
import { WallStage } from "./wall/WallStage";
import { useVideoRefUrl } from "@/hooks/useVideoRefUrl";
import { usePersonPreview } from "./AvatarField";
import { defaultDesign } from "../../convex/lib/wallOfTextDesign";
import { SlideshowPreview } from "./slideshow/ImageSetPicker";

/**
 * The right-hand panel.
 *
 * `preview` is a union, not a constant, and Carousel is why: a deck is stills
 * you page through, not a video you scrub. Writing this against a player and
 * special-casing decks later is exactly the mistake Phase 0 exists to prevent.
 */
export function PreviewPanel({
  format,
  values,
  running,
}: {
  format: FormatDefinition;
  values: Record<string, unknown>;
  running: boolean;
}) {
  if (running) return <StepList format={format} />;

  if (format.id === "wall-of-text" && convexConfigured) {
    return (
      <AuthorisedBoundary>
        <WallPreview videoRef={typeof values.video === "string" ? values.video : null} />
      </AuthorisedBoundary>
    );
  }

  if (format.id === "image-slideshow" && convexConfigured) {
    return (
      <AuthorisedBoundary>
        <SlideshowPreview value={values.images} />
      </AuthorisedBoundary>
    );
  }

  switch (format.preview) {
    case "deck":
      return <DeckPreview slideCount={Number(values.slideCount) || 7} />;
    case "image":
      return <Frame label="Still — approve before it animates" ratio="4/5" />;
    case "video":
    default:
      return <Frame label="Video preview" ratio="9/16" />;
  }
}

/** Never an empty box: a format shows an example of its own output at rest. */
function DeckPreview({ slideCount }: { slideCount: number }) {
  const [slide, setSlide] = useState(0);
  const total = slideCount;
  // Dragging the slider below the current slide must not strand the pager
  // past the end of the deck.
  const current = Math.min(slide, total - 1);
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex w-full max-w-[280px] items-center justify-center rounded-xl border border-line bg-surface-sub p-6 text-center"
        style={{ aspectRatio: "4 / 5" }}
      >
        <p className="text-sm text-muted">
          Slide {current + 1} renders here at 1080×1350, scaled down.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSlide(Math.max(0, current - 1))}
          disabled={current === 0}
          className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40"
        >
          ←
        </button>
        <span className="font-mono text-xs tabular-nums text-muted">
          {current + 1} / {total}
        </span>
        <button
          onClick={() => setSlide(Math.min(total - 1, current + 1))}
          disabled={current === total - 1}
          className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}

/**
 * The chosen clip with sample text in the format's default look -- the same
 * stage the studio edits on, so the first thing the studio shows is what this
 * promised.
 */
const SAMPLE =
  "pov: you finally stop doing it the hard way and wonder why nobody told you sooner. mine's in the comments <3";

function WallPreview({ videoRef }: { videoRef: string | null }) {
  const videoUrl = useVideoRefUrl(videoRef);
  const person = usePersonPreview(videoRef);
  const filming = Boolean(videoRef) && !/^(clip|video):/.test(videoRef ?? "");
  return (
    <div className="flex flex-col items-center gap-3">
      <WallStage
        design={defaultDesign(SAMPLE)}
        videoUrl={videoUrl}
        posterUrl={filming ? person.faces[0] ?? null : null}
        width={260}
      />
      <p className="max-w-[260px] text-center text-xs leading-snug text-muted">
        {!filming
          ? "Sample text. Yours is written from your prompt, and you style it on the video before it renders."
          : videoRef?.startsWith("cast:")
            ? "We'll cast someone new and film them in a casual phone selfie. You style the text on it next."
            : "We'll film them in a casual phone selfie. You style the text on it next."}
      </p>
    </div>
  );
}

function Frame({ label, ratio }: { label: string; ratio: string }) {
  return (
    <div className="flex justify-center">
      <div
        className="flex w-full max-w-[260px] items-center justify-center rounded-xl border border-line bg-surface-sub p-6 text-center text-sm text-muted"
        style={{ aspectRatio: ratio.replace("/", " / ") }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * During a run this replaces the preview. These jobs take minutes, so showing
 * which of five steps you are on is the difference between "working" and
 * "broken" -- and it comes free from the workflow's own persisted progress.
 */
function StepList({ format }: { format: FormatDefinition }) {
  return (
    <ol className="space-y-2">
      {format.pipeline.map((step, i) => (
        <li
          key={step.id}
          className="flex items-center gap-3 rounded-lg border border-line bg-surface-sub px-3 py-2"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[0.65rem]">
            {i + 1}
          </span>
          <span className="flex-1 text-sm">{step.label}</span>
          <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            {step.primitive}
            {step.gate ? " · gate" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
