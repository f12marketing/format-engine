"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  blockStyle,
  FRAME,
  googleFontsHref,
  lineStyle,
  overlayStyle,
  textLines,
  textStyle,
  type WallDesign,
} from "../../../convex/lib/wallOfTextDesign";
import { useGoogleFont } from "./useGoogleFont";

export type Selection = "text" | "overlay" | null;

/**
 * The video with its text on top, at phone size.
 *
 * The text and overlay are drawn inside a full 1080x1920 frame scaled down
 * with a CSS transform, from the same style functions the render page uses --
 * so positions, wrapping and line breaks here are the render's, not an
 * approximation of them. Interactive, it lets the text and the overlay be
 * dragged into place and resized; otherwise it's a plain preview.
 */
export function WallStage({
  design,
  videoUrl,
  posterUrl = null,
  audioUrl = null,
  overlayUrl = null,
  width,
  interactive = false,
  selected = null,
  onSelect,
  onChange,
  onEditText,
  placeholder = "Your text appears here",
}: {
  design: WallDesign;
  videoUrl: string | null;
  /** A still to show when there is no clip yet -- the person a run will film. */
  posterUrl?: string | null;
  /** A replacement track. Null plays the video's own sound. */
  audioUrl?: string | null;
  overlayUrl?: string | null;
  /** Display width in CSS pixels; the height follows at 9:16. */
  width: number;
  interactive?: boolean;
  selected?: Selection;
  onSelect?: (s: Selection) => void;
  /** `key` names the gesture or control, so the studio can fold a drag into one undo step. */
  onChange?: (patch: Partial<WallDesign>, key: string) => void;
  onEditText?: () => void;
  placeholder?: string;
}) {
  useGoogleFont(googleFontsHref(design.font));
  const height = (width * FRAME.height) / FRAME.width;
  const k = width / FRAME.width;

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean } | null>(null);

  // A replacement track follows the video: same play state, and back to the
  // top whenever the video loops.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    let last = 0;
    const onTime = () => {
      if (v.currentTime < last - 0.25) a.currentTime = 0;
      last = v.currentTime;
    };
    const onPlay = () => void a.play().catch(() => {});
    const onPause = () => a.pause();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [audioUrl, videoUrl]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    const a = audioRef.current;
    const v = videoRef.current;
    // Browsers only allow sound after a click, which this is -- so start the
    // track here rather than waiting for the next play event.
    if (a && !next && v && !v.paused) {
      a.currentTime = v.currentTime % (a.duration || Infinity);
      void a.play().catch(() => {});
    }
  }

  let gesture = 0;
  function startGesture(
    e: ReactPointerEvent,
    kind: "text-move" | "text-left" | "text-right" | "ov-move" | "ov-resize",
  ) {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(kind.startsWith("text") ? "text" : "overlay");
    const key = `drag-${Date.now()}-${++gesture}`;
    const d0 = design;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
    // Within 1.5% of the centre line it sticks, and a guide shows why.
    const snap = (n: number) => (Math.abs(n - 0.5) < 0.015 ? 0.5 : n);

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / width;
      const dy = (ev.clientY - y0) / height;
      if (kind === "text-move") {
        const x = d0.background === "snapchat" ? d0.x : snap(clamp(d0.x + dx));
        const y = snap(clamp(d0.y + dy, 0.03, 0.97));
        setGuides({ v: x === 0.5 && d0.background !== "snapchat", h: y === 0.5 });
        onChange?.({ x, y }, key);
      } else if (kind === "text-right" || kind === "text-left") {
        const grow = kind === "text-right" ? dx : -dx;
        onChange?.({ width: clamp(d0.width + 2 * grow, 0.3, 1) }, key);
      } else if (kind === "ov-move" && d0.overlay) {
        const x = snap(clamp(d0.overlay.x + dx));
        const y = snap(clamp(d0.overlay.y + dy));
        setGuides({ v: x === 0.5, h: y === 0.5 });
        onChange?.({ overlay: { ...d0.overlay, x, y } }, key);
      } else if (kind === "ov-resize" && d0.overlay) {
        onChange?.({ overlay: { ...d0.overlay, w: clamp(d0.overlay.w + 2 * dx, 0.05, 1) } }, key);
      }
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setGuides(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  // Handles and outlines live inside the scaled frame, so their sizes are
  // divided by the scale to come out at a constant on-screen size.
  const px = (n: number) => `${n / k}px`;
  const ring = (on: boolean): CSSProperties =>
    on
      ? { outline: `${px(2)} solid var(--accent)`, outlineOffset: px(4) }
      : interactive
        ? { outline: `${px(1)} dashed transparent`, outlineOffset: px(4) }
        : {};
  const handle = (side: "left" | "right" | "corner"): CSSProperties => ({
    position: "absolute",
    width: px(12),
    height: px(12),
    borderRadius: "999px",
    background: "var(--accent)",
    border: `${px(2)} solid #fff`,
    boxShadow: `0 0 0 ${px(1)} rgba(0,0,0,.2)`,
    ...(side === "corner"
      ? { right: px(-10), bottom: px(-10), cursor: "nwse-resize" }
      : { top: "50%", [side]: px(-10), transform: "translateY(-50%)", cursor: "ew-resize" }),
  });

  const textSelected = interactive && selected === "text";
  const overlaySelected = interactive && selected === "overlay";

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-2xl bg-black shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/10 select-none"
      style={{ width, height }}
      onPointerDown={() => interactive && onSelect?.(null)}
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          key={videoUrl}
          src={videoUrl}
          autoPlay
          loop
          playsInline
          muted={audioUrl ? true : muted}
          className="absolute inset-0 size-full object-cover"
        />
      ) : posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={posterUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-[#3a2f3f] to-[#15121a] px-6 text-center text-xs text-white/60">
          Choose a video to preview it here
        </div>
      )}
      {audioUrl && <audio ref={audioRef} key={audioUrl} src={audioUrl} muted={muted} preload="auto" />}

      {/* The 1080x1920 frame, scaled to fit. */}
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: FRAME.width, height: FRAME.height, transform: `scale(${k})` }}
      >
        {design.overlay && overlayUrl && (
          // The render page places the <img> itself with these styles; here it
          // sits in a box placed the same way, so the box can carry a handle.
          <div
            style={{
              ...(overlayStyle(design.overlay) as CSSProperties),
              ...ring(overlaySelected),
              pointerEvents: interactive ? "auto" : "none",
              cursor: interactive ? "move" : undefined,
            }}
            onPointerDown={(e) => startGesture(e, "ov-move")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={overlayUrl} alt="" draggable={false} className="block h-auto w-full" />
            {overlaySelected && (
              <span style={handle("corner")} onPointerDown={(e) => startGesture(e, "ov-resize")} />
            )}
          </div>
        )}

        <div
          style={{
            ...(blockStyle(design) as CSSProperties),
            ...ring(textSelected),
            pointerEvents: interactive ? "auto" : "none",
            cursor: interactive ? "move" : undefined,
          }}
          onPointerDown={(e) => startGesture(e, "text-move")}
          onDoubleClick={onEditText}
        >
          <p style={textStyle(design) as CSSProperties}>
            {design.text ? (
              textLines(design.text).map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && "\n"}
                  {line && <span style={lineStyle(design) as CSSProperties}>{line}</span>}
                </Fragment>
              ))
            ) : (
              <span style={{ ...(lineStyle(design) as CSSProperties), opacity: 0.55 }}>{placeholder}</span>
            )}
          </p>
          {textSelected && design.background !== "snapchat" && (
            <>
              <span style={handle("left")} onPointerDown={(e) => startGesture(e, "text-left")} />
              <span style={handle("right")} onPointerDown={(e) => startGesture(e, "text-right")} />
            </>
          )}
        </div>
      </div>

      {guides?.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />}
      {guides?.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent/80" />}

      {videoUrl && (
        <div className="absolute right-2.5 top-2.5 flex gap-1.5">
          <StageButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
            {muted ? <MutedIcon /> : <SoundIcon />}
          </StageButton>
          <StageButton label={playing ? "Pause" : "Play"} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </StageButton>
        </div>
      )}
    </div>
  );
}

function StageButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65"
    >
      {children}
    </button>
  );
}

const icon = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PauseIcon() {
  return (
    <svg {...icon}>
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...icon} fill="currentColor">
      <path d="M7 4.5v15l12-7.5-12-7.5Z" />
    </svg>
  );
}
function MutedIcon() {
  return (
    <svg {...icon}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </svg>
  );
}
function SoundIcon() {
  return (
    <svg {...icon}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}
