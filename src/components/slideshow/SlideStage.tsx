"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  frameOf,
  googleFontsHref,
  lineStyle,
  overlayLayerStyle,
  pictureStyle,
  textBlockStyle,
  textLines,
  textStyle,
  type Slide,
  type SlidePicture,
  type SlideRatio,
  type SlideText,
} from "../../../convex/lib/imageSlideshowDesign";

export type Selection = { kind: "text" | "picture"; id: string } | null;

/** Page-wide, so a drag's undo key never repeats even as stages remount slide to slide. */
let gestureSeq = 0;

/** Loads each face a slide uses, once per page -- the same stylesheets the export links. */
function useSlideFonts(fonts: string[]) {
  const key = [...new Set(fonts)].sort().join("|");
  useEffect(() => {
    for (const font of key.split("|").filter(Boolean)) {
      const href = googleFontsHref(font);
      const id = `gf-${href}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }, [key]);
}

/**
 * One slide, at any size.
 *
 * Drawn inside a full-size frame (1080 wide) scaled down with a CSS transform,
 * from the same style functions the export page uses -- so wrapping, line
 * breaks and positions here are the exported image's, not an approximation.
 * Interactive, its text boxes and pictures can be selected, dragged, resized
 * and -- on double-click -- typed into in place.
 */
export function SlideStage({
  slide,
  ratio,
  urls,
  width,
  placeholderBackground,
  interactive = false,
  selected = null,
  editingId = null,
  onSelect,
  onText,
  onPicture,
  onStartEdit,
  onEndEdit,
  className = "",
}: {
  slide: Slide;
  ratio: SlideRatio;
  /** Asset id → URL, for the photo, overlay and pictures. */
  urls: Record<string, string>;
  /** Display width in CSS pixels; the height follows the ratio. */
  width: number;
  /** Stands in for the photo when there is none (the template gallery's previews). */
  placeholderBackground?: string;
  interactive?: boolean;
  selected?: Selection;
  editingId?: string | null;
  onSelect?: (s: Selection) => void;
  /** `key` names the gesture, so the editor can fold a whole drag into one undo step. */
  onText?: (id: string, patch: Partial<SlideText>, key: string) => void;
  onPicture?: (id: string, patch: Partial<SlidePicture>, key: string) => void;
  onStartEdit?: (id: string) => void;
  onEndEdit?: () => void;
  className?: string;
}) {
  const frame = frameOf(ratio);
  const k = width / frame.width;
  const height = frame.height * k;
  useSlideFonts(slide.texts.map((t) => t.font));
  const [guides, setGuides] = useState<{ v: boolean; h: boolean } | null>(null);

  const photo = slide.imageAssetId ? urls[slide.imageAssetId] : undefined;
  const overlayImage = slide.overlay?.assetId ? urls[slide.overlay.assetId] : undefined;

  function startGesture(
    e: ReactPointerEvent,
    kind: "text-move" | "text-left" | "text-right" | "pic-move" | "pic-resize",
    id: string,
  ) {
    if (!interactive) return;
    e.stopPropagation();
    if (editingId === id) return;
    e.preventDefault();
    onSelect?.({ kind: kind.startsWith("text") ? "text" : "picture", id });
    const key = `drag-${++gestureSeq}`;
    const t0 = slide.texts.find((t) => t.id === id);
    const p0 = slide.pictures.find((p) => p.id === id);
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
      if (kind === "text-move" && t0) {
        const bar = t0.background === "snapchat";
        const x = bar ? t0.x : snap(clamp(t0.x + dx));
        const y = snap(clamp(t0.y + dy, 0.02, 0.98));
        setGuides({ v: x === 0.5 && !bar, h: y === 0.5 });
        onText?.(id, { x, y }, key);
      } else if ((kind === "text-left" || kind === "text-right") && t0) {
        const grow = kind === "text-right" ? dx : -dx;
        onText?.(id, { width: clamp(t0.width + 2 * grow, 0.2, 1) }, key);
      } else if (kind === "pic-move" && p0) {
        const x = snap(clamp(p0.x + dx));
        const y = snap(clamp(p0.y + dy));
        setGuides({ v: x === 0.5, h: y === 0.5 });
        onPicture?.(id, { x, y }, key);
      } else if (kind === "pic-resize" && p0) {
        onPicture?.(id, { w: clamp(p0.w + 2 * dx, 0.05, 1) }, key);
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
      ? { right: px(-8), bottom: px(-8), cursor: "nwse-resize" }
      : { top: "50%", [side]: px(-10), transform: "translateY(-50%)", cursor: "ew-resize" }),
  });

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-[#111] select-none ${className}`}
      style={{ width, height, background: photo ? undefined : placeholderBackground }}
      onPointerDown={() => interactive && onSelect?.(null)}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: frame.width, height: frame.height, transform: `scale(${k})` }}
      >
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-cover"
          />
        )}

        {slide.overlay &&
          (overlayImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={overlayImage}
              alt=""
              draggable={false}
              className="pointer-events-none"
              style={{
                ...(overlayLayerStyle(slide.overlay) as CSSProperties),
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : slide.overlay.preset ? (
            <div className="pointer-events-none" style={overlayLayerStyle(slide.overlay) as CSSProperties} />
          ) : null)}

        {slide.pictures.map((p) => {
          const src = urls[p.assetId];
          const on = interactive && selected?.kind === "picture" && selected.id === p.id;
          return (
            <div
              key={p.id}
              style={{
                ...(pictureStyle(p, frame) as CSSProperties),
                overflow: "visible",
                ...ring(on),
                pointerEvents: interactive ? "auto" : "none",
                cursor: interactive ? "move" : undefined,
              }}
              onPointerDown={(e) => startGesture(e, "pic-move", p.id)}
            >
              <div style={{ borderRadius: `${p.radius}px`, overflow: "hidden" }}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" draggable={false} className="block h-auto w-full" />
                ) : (
                  <div className="aspect-square w-full bg-white/20" />
                )}
              </div>
              {on && <span style={handle("corner")} onPointerDown={(e) => startGesture(e, "pic-resize", p.id)} />}
            </div>
          );
        })}

        {slide.texts.map((t) => {
          const on = interactive && selected?.kind === "text" && selected.id === t.id;
          const editing = interactive && editingId === t.id;
          if (!t.text.trim() && !on && !editing && !interactive) return null;
          return (
            <div
              key={t.id}
              style={{
                ...(textBlockStyle(t, frame) as CSSProperties),
                ...ring(on || editing),
                pointerEvents: interactive ? "auto" : "none",
                cursor: interactive ? (editing ? "text" : "move") : undefined,
              }}
              onPointerDown={(e) => startGesture(e, "text-move", t.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEdit?.(t.id);
              }}
            >
              {editing ? (
                <p style={textStyle(t) as CSSProperties}>
                  <InlineEditor
                    text={t.text}
                    style={lineStyle(t) as CSSProperties}
                    onInput={(text) => onText?.(t.id, { text }, `type-${t.id}`)}
                    onDone={() => onEndEdit?.()}
                  />
                </p>
              ) : (
                <p style={textStyle(t) as CSSProperties}>
                  {t.text ? (
                    textLines(t.text).map((line, i) => (
                      <Fragment key={i}>
                        {i > 0 && "\n"}
                        {line && <span style={lineStyle(t) as CSSProperties}>{line}</span>}
                      </Fragment>
                    ))
                  ) : (
                    <span style={{ ...(lineStyle(t) as CSSProperties), opacity: 0.5 }}>Double-click to type</span>
                  )}
                </p>
              )}
              {on && !editing && t.background !== "snapchat" && (
                <>
                  <span style={handle("left")} onPointerDown={(e) => startGesture(e, "text-left", t.id)} />
                  <span style={handle("right")} onPointerDown={(e) => startGesture(e, "text-right", t.id)} />
                </>
              )}
            </div>
          );
        })}
      </div>

      {guides?.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />}
      {guides?.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent/80" />}
    </div>
  );
}

/**
 * Typing straight onto the slide. The span is uncontrolled while it has
 * focus -- React re-rendering its text on every keystroke would throw the
 * caret back to the start -- and reports what it holds on each input.
 */
function InlineEditor({
  text,
  style,
  onInput,
  onDone,
}: {
  text: string;
  style: CSSProperties;
  onInput: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mount only: from here the element owns its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, outline: "none", minWidth: "0.5em", display: "inline" }}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => onInput((e.currentTarget.textContent ?? "").slice(0, 600))}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") (e.currentTarget as HTMLElement).blur();
      }}
    />
  );
}
