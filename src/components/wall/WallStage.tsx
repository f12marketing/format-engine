"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  blockStyle,
  designFonts,
  FRAME,
  fontsHref,
  lineStyle,
  memeStyle,
  overlayStyle,
  textLines,
  textStyle,
  type WallDesign,
  type WallText,
} from "../../../convex/lib/wallOfTextDesign";
import { useGoogleFont } from "./useGoogleFont";

/** A text on the stage: the main one, or an added text box by its index. */
export type TextTarget = "text" | number;
export type Selection = TextTarget | "overlay" | "meme" | null;

/** Green Screen Meme's GIF or clip, as the stage draws it; where it sits is the design's `meme` layer. */
export interface StageMeme {
  url: string;
  isVideo: boolean;
  /** Width over height. */
  aspect: number;
}

export function textAt(d: WallDesign, t: TextTarget): WallText | undefined {
  return t === "text" ? d : d.boxes?.[t];
}

/** A change to one text, as a change to the design. */
export function patchText(d: WallDesign, t: TextTarget, patch: Partial<WallText>): Partial<WallDesign> {
  return t === "text" ? patch : { boxes: (d.boxes ?? []).map((b, i) => (i === t ? { ...b, ...patch } : b)) };
}

/**
 * The video with its text on top, at phone size.
 *
 * The text and overlay are drawn inside a full 1080x1920 frame scaled down
 * with a CSS transform, from the same style functions the render page uses --
 * so positions, wrapping and line breaks here are the render's, not an
 * approximation of them. Interactive, it lets the text, any added text boxes
 * and the overlay be dragged into place and resized; otherwise it's a plain
 * preview.
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
  maxSeconds = null,
  meme = null,
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
  onEditText?: (t: TextTarget) => void;
  placeholder?: string;
  /** Loop only the first this-many seconds -- all of the clip that makes the video. */
  maxSeconds?: number | null;
  /** Green Screen Meme's meme, drawn under the text where `design.meme` places it. */
  meme?: StageMeme | null;
}) {
  useGoogleFont(fontsHref(designFonts(design)));
  const height = (width * FRAME.height) / FRAME.width;
  const k = width / FRAME.width;

  const videoRef = useRef<HTMLVideoElement>(null);
  const memeRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const chromaId = `chroma-${useId().replace(/:/g, "")}`;
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

  // Back to the top at the cut, which the audio effect above reads as a loop.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !maxSeconds) return;
    const onTime = () => {
      if (v.currentTime >= maxSeconds) v.currentTime = 0;
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [maxSeconds, videoUrl]);

  function togglePlay() {
    // The background and a moving meme play and pause together.
    const all = [videoRef.current, memeRef.current].filter((v): v is HTMLVideoElement => Boolean(v));
    if (!all.length) return;
    if (all[0].paused) {
      for (const v of all) void v.play().catch(() => {});
      setPlaying(true);
    } else {
      for (const v of all) v.pause();
      setPlaying(false);
    }
  }

  // Whose sound the preview plays follows the meme's Sound setting, as the render's does.
  const sound = design.meme?.sound;
  const backgroundMuted = audioUrl ? true : muted || (sound !== undefined && sound !== "background");
  const memeMuted = muted || sound !== "meme";

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
    kind: "text-move" | "text-left" | "text-right" | "ov-move" | "ov-resize" | "meme-move" | "meme-resize",
    which: TextTarget = "text",
  ) {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect?.(kind.startsWith("text") ? which : kind.startsWith("meme") ? "meme" : "overlay");
    const key = `drag-${e.timeStamp}-${++gesture}`;
    const d0 = design;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
    // Within 1.5% of the centre line it sticks, and a guide shows why.
    const snap = (n: number) => (Math.abs(n - 0.5) < 0.015 ? 0.5 : n);

    const t0 = textAt(d0, which);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / width;
      const dy = (ev.clientY - y0) / height;
      if (kind === "text-move" && t0) {
        const x = t0.background === "snapchat" ? t0.x : snap(clamp(t0.x + dx));
        const y = snap(clamp(t0.y + dy, 0.03, 0.97));
        setGuides({ v: x === 0.5 && t0.background !== "snapchat", h: y === 0.5 });
        onChange?.(patchText(d0, which, { x, y }), key);
      } else if ((kind === "text-right" || kind === "text-left") && t0) {
        const grow = kind === "text-right" ? dx : -dx;
        onChange?.(patchText(d0, which, { width: clamp(t0.width + 2 * grow, 0.3, 1) }), key);
      } else if (kind === "ov-move" && d0.overlay) {
        const x = snap(clamp(d0.overlay.x + dx));
        const y = snap(clamp(d0.overlay.y + dy));
        setGuides({ v: x === 0.5, h: y === 0.5 });
        onChange?.({ overlay: { ...d0.overlay, x, y } }, key);
      } else if (kind === "ov-resize" && d0.overlay) {
        onChange?.({ overlay: { ...d0.overlay, w: clamp(d0.overlay.w + 2 * dx, 0.05, 1) } }, key);
      } else if (kind === "meme-move" && d0.meme) {
        const x = snap(clamp(d0.meme.x + dx));
        const y = snap(clamp(d0.meme.y + dy));
        setGuides({ v: x === 0.5, h: y === 0.5 });
        onChange?.({ meme: { ...d0.meme, x, y } }, key);
      } else if (kind === "meme-resize" && d0.meme) {
        // Growing from the corner keeps the centre where it is, so both sides move.
        onChange?.({ meme: { ...d0.meme, w: clamp(d0.meme.w + 2 * dx, 0.1, 1.6) } }, key);
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

  const overlaySelected = interactive && selected === "overlay";
  const memeSelected = interactive && selected === "meme";

  function textBlock(t: WallText, target: TextTarget, emptyText: string) {
    const on = interactive && selected === target;
    return (
      <div
        key={target}
        style={{
          ...(blockStyle(t) as CSSProperties),
          ...ring(on),
          pointerEvents: interactive ? "auto" : "none",
          cursor: interactive ? "move" : undefined,
        }}
        onPointerDown={(e) => startGesture(e, "text-move", target)}
        onDoubleClick={() => onEditText?.(target)}
      >
        <p style={textStyle(t) as CSSProperties}>
          {t.text ? (
            textLines(t.text).map((line, i) => (
              <Fragment key={i}>
                {i > 0 && "\n"}
                {line && <span style={lineStyle(t) as CSSProperties}>{line}</span>}
              </Fragment>
            ))
          ) : (
            <span style={{ ...(lineStyle(t) as CSSProperties), opacity: 0.55 }}>{emptyText}</span>
          )}
        </p>
        {on && t.background !== "snapchat" && (
          <>
            <span style={handle("left")} onPointerDown={(e) => startGesture(e, "text-left", target)} />
            <span style={handle("right")} onPointerDown={(e) => startGesture(e, "text-right", target)} />
          </>
        )}
      </div>
    );
  }

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
          muted={backgroundMuted}
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
        {design.meme && meme && (
          // Under the text, as the render composites it; the box is placed from
          // the same fractions the render service reads.
          <div
            style={{
              ...(memeStyle(design.meme, meme.aspect) as CSSProperties),
              ...ring(memeSelected),
              pointerEvents: interactive ? "auto" : "none",
              cursor: interactive ? "move" : undefined,
            }}
            onPointerDown={(e) => startGesture(e, "meme-move")}
          >
            {meme.isVideo ? (
              <video
                ref={memeRef}
                key={meme.url}
                src={meme.url}
                autoPlay
                loop
                playsInline
                muted={memeMuted}
                style={memeLook(design.meme, chromaId)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meme.url} alt="" draggable={false} style={memeLook(design.meme, chromaId)} />
            )}
            {memeSelected && (
              <span style={handle("corner")} onPointerDown={(e) => startGesture(e, "meme-resize")} />
            )}
          </div>
        )}

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

        {textBlock(design, "text", placeholder)}
        {(design.boxes ?? []).map((b, i) => textBlock(b, i, "Type your text"))}
      </div>

      {guides?.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />}
      {guides?.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent/80" />}

      {design.meme?.chroma && <ChromaFilter id={chromaId} />}

      {(videoUrl || meme?.isVideo) && (
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

/** The meme's media inside its box: stretched to it, mirrored and keyed as the layer says. */
export function memeLook(m: { flip: boolean; chroma: boolean }, chromaId: string): CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "fill",
    transform: m.flip ? "scaleX(-1)" : undefined,
    filter: m.chroma ? `url(#${chromaId})` : undefined,
  };
}

/**
 * The green screen, keyed in the preview: a pixel goes clear only where green
 * beats red AND blue -- two masks, 1 - 3(G - R) and 1 - 3(G - B), where
 * either one keeps it. Studio green is gone; skin, yellow, cyan, white and
 * black stay whole (a single "green minus the others" mask would eat yellow
 * too). Close to the render's chromakey, not identical: the render samples
 * the actual green from the meme's corner.
 */
export function ChromaFilter({ id }: { id: string }) {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 -3 0 0 1" result="red" />
        <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 -3 3 0 1" result="blue" />
        {/* "over" unions the two: alpha = 1 - (1 - a)(1 - b). */}
        <feComposite in="red" in2="blue" operator="over" />
        {/* Multiplied back by the source's own alpha, so a sticker's cut-out stays cut out. */}
        <feComposite in2="SourceGraphic" operator="in" />
      </filter>
    </svg>
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
