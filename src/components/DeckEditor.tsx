"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CAROUSEL_LIMITS, type CarouselSlide } from "../../convex/lib/carouselPrompt";
import { CAROUSEL_TEMPLATES } from "../../convex/lib/carouselTemplates";
import { SlideView } from "./SlideView";

type Field = keyof typeof CAROUSEL_LIMITS;
type SlideText = Record<Field, string>;

const FIELDS = Object.keys(CAROUSEL_LIMITS) as Field[];

const FIELD_LABEL: Record<Field, string> = {
  kicker: "Kicker",
  headline: "Headline",
  body: "Body",
  swipe_cue: "Swipe cue",
};

/** About the width an Instagram or LinkedIn feed gives a 4:5 carousel on desktop. */
const PREVIEW_MAX_WIDTH = 440;
const THUMB_WIDTH = 136;

const inputClass =
  "w-full resize-none rounded-md border border-line bg-surface-sub px-2 py-1.5 text-sm outline-none " +
  "field-sizing-content focus:border-accent read-only:cursor-default read-only:bg-transparent";

function textOf(s: CarouselSlide): SlideText {
  return {
    kicker: s.kicker ?? "",
    headline: s.headline ?? "",
    body: s.body ?? "",
    swipe_cue: s.swipe_cue ?? "",
  };
}

/** Tracks an element's content width, so the preview can scale to its column. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The creative area: templates on the left, one slide previewed at social-feed
 * size on the right, and that slide's text underneath. Step through the deck
 * with the arrows and edit each slide in turn.
 *
 * The preview is the export's own markup and stylesheets (see SlideView), so
 * picking a template or typing a line is instant and shows what the render
 * will produce. Nothing is saved until "Re-render with edits", which starts a
 * new job (`carousel.rerenderEdited`) and leaves this one -- and any post
 * scheduled from its images -- untouched. Limits are the same budgets the copy
 * step is held to; every template is designed to hold them.
 */
export function DeckEditor({
  jobId,
  slides,
  template: savedTemplate,
  aspectRatio,
  editable,
}: {
  jobId: Id<"jobs">;
  slides: CarouselSlide[];
  template: string;
  aspectRatio: string;
  editable: boolean;
}) {
  const rerender = useMutation(api.carousel.rerenderEdited);
  const router = useRouter();
  const saved = slides.map(textOf);
  const [draft, setDraft] = useState<SlideText[]>(saved);
  const [template, setTemplate] = useState(savedTemplate);
  const [current, setCurrent] = useState(0);
  const [overflows, setOverflows] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameRef, frameWidth] = useElementWidth<HTMLDivElement>();

  const total = slides.length;
  const changed = draft.map((d, i) => FIELDS.some((f) => d[f] !== saved[i][f]));
  const dirty = changed.some(Boolean) || template !== savedTemplate;

  const problems = draft.flatMap((d, i) => {
    const out: { slide: number; text: string }[] = [];
    if (!d.headline.trim()) out.push({ slide: i, text: "needs a headline" });
    for (const f of FIELDS) {
      const len = d[f].trim().length;
      if (len > CAROUSEL_LIMITS[f]) {
        out.push({ slide: i, text: `${FIELD_LABEL[f].toLowerCase()} is ${len}/${CAROUSEL_LIMITS[f]}` });
      }
    }
    return out;
  });

  const slideAt = (i: number) => ({ ...draft[i], role: slides[i].role });
  const templateName = CAROUSEL_TEMPLATES.find((t) => t.id === template)?.name ?? template;

  function edit(field: Field, value: string) {
    setDraft((cur) => cur.map((d, j) => (j === current ? { ...d, [field]: value } : d)));
  }

  function discard() {
    setDraft(saved);
    setTemplate(savedTemplate);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const newJobId = await rerender({
        jobId,
        slides: draft,
        template: template !== savedTemplate ? template : undefined,
      });
      router.push(`/jobs/${newJobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Deck — {total} slides
      </h2>

      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Templates: a column beside the preview, a swipeable row on a phone. */}
        <div className="sm:sticky sm:top-4 sm:w-44 sm:shrink-0">
          <p className="mb-1.5 text-xs font-semibold">Template</p>
          <ul
            className="flex gap-2 overflow-x-auto p-0.5 sm:max-h-[calc(100vh-6rem)] sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto"
            aria-label="Templates"
          >
            {CAROUSEL_TEMPLATES.map((t) => (
              <li key={t.id} className="shrink-0">
                <TemplateThumb
                  name={t.name}
                  blurb={t.blurb}
                  selected={t.id === template}
                  disabled={!editable}
                  onPick={() => setTemplate(t.id)}
                  slide={slideAt(current)}
                  index={current}
                  total={total}
                  templateId={t.id}
                  aspectRatio={aspectRatio}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 flex-1">
          <div
            ref={frameRef}
            className="mx-auto w-full overflow-hidden rounded-[10px] border border-line shadow-sm"
            style={{ maxWidth: PREVIEW_MAX_WIDTH }}
          >
            {frameWidth > 0 && (
              <SlideView
                slide={slideAt(current)}
                index={current}
                total={total}
                template={template}
                aspectRatio={aspectRatio}
                width={frameWidth}
                onOverflow={setOverflows}
              />
            )}
          </div>

          <div className="mt-3 flex items-center justify-center gap-4">
            <NavButton
              label="Previous slide"
              disabled={current === 0}
              onClick={() => setCurrent(current - 1)}
            >
              ‹
            </NavButton>
            <p className="min-w-28 text-center font-mono text-xs uppercase tracking-wide text-muted">
              {current + 1} / {total}
              {slides[current].role ? ` · ${slides[current].role}` : ""}
              {changed[current] && <span className="text-warn"> · edited</span>}
            </p>
            <NavButton
              label="Next slide"
              disabled={current === total - 1}
              onClick={() => setCurrent(current + 1)}
            >
              ›
            </NavButton>
          </div>

          <div className="mt-1.5 flex justify-center">
            {draft.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Go to slide ${i + 1}${changed[i] ? " (edited)" : ""}`}
                aria-current={i === current}
                className="flex size-5 items-center justify-center"
              >
                <span
                  className={`size-2 rounded-full ${
                    i === current ? "bg-accent" : changed[i] ? "bg-warn" : "bg-line-strong"
                  }`}
                />
              </button>
            ))}
          </div>

          {overflows && (
            <p
              role="status"
              className="mt-3 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs text-accent"
            >
              This slide overflows in {templateName}. Shorten it below, or pick a template with more
              room (thumbnails marked Overflows run over too).
            </p>
          )}

          <div className="mt-4 space-y-2.5">
            {FIELDS.map((f) => {
              const value = draft[current][f];
              const len = value.trim().length;
              const over = len > CAROUSEL_LIMITS[f];
              const Tag = f === "kicker" ? "input" : "textarea";
              return (
                <label key={f} className="block">
                  <span className="flex items-baseline justify-between text-xs text-muted">
                    <span>{FIELD_LABEL[f]}</span>
                    {editable && (
                      <span className={`font-mono ${over ? "text-accent" : ""}`}>
                        {len}/{CAROUSEL_LIMITS[f]}
                      </span>
                    )}
                  </span>
                  <Tag
                    value={value}
                    onChange={(e) => edit(f, e.target.value)}
                    readOnly={!editable}
                    {...(Tag === "textarea" ? { rows: 1 } : {})}
                    className={`${inputClass} ${over ? "border-accent" : ""}`}
                  />
                </label>
              );
            })}
          </div>

          {editable && (
            <div className="mt-4">
              {problems.length > 0 && (
                <p className="mb-2 text-xs text-accent">
                  Fix before re-rendering:{" "}
                  {problems.slice(0, 4).map((p, i) => (
                    <span key={i}>
                      {i > 0 && "; "}
                      <button
                        type="button"
                        onClick={() => setCurrent(p.slide)}
                        className="underline"
                      >
                        slide {p.slide + 1}
                      </button>{" "}
                      {p.text}
                    </span>
                  ))}
                  {problems.length > 4 && ` (+${problems.length - 4} more)`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={submit}
                  disabled={!dirty || problems.length > 0 || busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Re-rendering…" : "Re-render with edits"}
                </button>
                {dirty && !busy && (
                  <button
                    onClick={discard}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent"
                  >
                    Discard edits
                  </button>
                )}
                <p className="text-xs text-muted">
                  {dirty
                    ? "Free, and opens as a new run. This one is kept."
                    : "Pick a template or edit any slide, then re-render for new images."}
                </p>
              </div>
              {error && <p className="mt-2 text-xs text-accent">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-full border border-line bg-surface text-lg leading-none hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** A template in the picker, shown as the current slide dressed in it. */
function TemplateThumb({
  name,
  blurb,
  selected,
  disabled,
  onPick,
  slide,
  index,
  total,
  templateId,
  aspectRatio,
}: {
  name: string;
  blurb: string;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
  slide: Parameters<typeof SlideView>[0]["slide"];
  index: number;
  total: number;
  templateId: string;
  aspectRatio: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      title={blurb}
      className={`block rounded-xl border p-1.5 text-left ${
        selected ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong"
      } ${over && !selected ? "border-dashed border-warn" : ""} disabled:cursor-default`}
    >
      <span className="pointer-events-none block select-none">
        <SlideView
          slide={slide}
          index={index}
          total={total}
          template={templateId}
          aspectRatio={aspectRatio}
          width={THUMB_WIDTH}
          onOverflow={setOver}
        />
      </span>
      <span className="mt-1.5 block px-0.5 text-xs font-medium">
        <span className="block">
          {name}
          {selected && <span className="text-ok"> ✓</span>}
        </span>
        {over && (
          <span className="block font-mono text-[0.55rem] uppercase tracking-wide text-warn">
            Overflows
          </span>
        )}
      </span>
    </button>
  );
}
