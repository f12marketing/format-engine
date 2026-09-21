"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import "@/carousel-templates/templates.css";
import { dimsFor, slideHtml } from "@/carousel-templates/slide-dom.js";
import type { CarouselSlide } from "../../convex/lib/carouselPrompt";

/**
 * One slide, drawn by the same markup and stylesheets the export uses.
 *
 * The slide is laid out at its TRUE pixel size (1080x1350 for 4:5) and then
 * shrunk with a CSS transform to `width`, exactly as `_base.css` describes --
 * so what shows here is the layout the render service will rasterise, and a
 * template switch is a re-style, not a re-render. `slideHtml` is the export's
 * own function and escapes every field, which is why it is safe to hand to
 * `dangerouslySetInnerHTML`.
 *
 * `onOverflow` reports whether the copy runs past the slide. The base CSS lets
 * `.slide-inner` overflow rather than clip for precisely this measurement.
 */
export function SlideView({
  slide,
  index,
  total,
  template,
  aspectRatio,
  width,
  onOverflow,
}: {
  slide: Pick<CarouselSlide, "role" | "kicker" | "headline" | "body" | "swipe_cue">;
  index: number;
  total: number;
  template: string;
  aspectRatio: string;
  /** Rendered width in CSS pixels; height follows the aspect ratio. */
  width: number;
  onOverflow?: (overflows: boolean) => void;
}) {
  const [w, h] = dimsFor(aspectRatio);
  const scale = width / w;
  const ref = useRef<HTMLDivElement>(null);

  // No branding and no footer, because `carousel.renderDeck` sends none either;
  // give the preview brand colours the export lacks and it stops matching.
  const html = useMemo(
    () =>
      slideHtml({
        slide,
        index,
        total,
        templateId: template,
        dims: [w, h],
        branding: undefined,
        footerLeft: "",
      }),
    [slide, index, total, template, w, h],
  );

  useLayoutEffect(() => {
    if (!onOverflow) return;
    const inner = ref.current?.querySelector<HTMLElement>(".slide-inner");
    if (!inner) return;
    const check = () =>
      onOverflow(
        inner.scrollHeight > inner.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1,
      );
    check();
    // System fonts can swap in after first paint and change how the copy wraps.
    let live = true;
    document.fonts?.ready.then(() => live && check());
    return () => {
      live = false;
    };
  }, [html, onOverflow]);

  return (
    <div className="slide-frame" style={{ width, height: h * scale }}>
      <div
        ref={ref}
        className="slide-scaler"
        style={{ width: w, height: h, transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
