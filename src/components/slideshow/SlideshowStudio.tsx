"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  DEFAULT_TEXT,
  deckAssetIds,
  frameOf,
  imageOverlay,
  MAX_PICTURES_PER_SLIDE,
  MAX_SLIDES,
  MAX_TEXT_CHARS,
  MAX_TEXTS_PER_SLIDE,
  newId,
  OVERLAY_PRESETS,
  presetOverlay,
  RATIO_USES,
  SLIDE_FONTS,
  SLIDE_RATIOS,
  SLIDE_SWATCHES,
  snapWeight,
  type Slide,
  type SlideDeck,
  type SlideOverlay,
  type SlidePicture,
  type SlideRatio,
  type SlideText,
  type TextBackground,
} from "../../../convex/lib/imageSlideshowDesign";
import { imageSetById, parseImageSource, setValue } from "../../../convex/lib/imageSets";
import { restyleSlide, templateById } from "../../../convex/lib/imageSlideshowTemplates";
import { SlideStage, type Selection } from "./SlideStage";
import { Dots, SourceSummary } from "./ImageSetPicker";
import { ImageSourceDialog, OverlayDialog, type PickedImage } from "./ImageSourceDialog";
import {
  AlignIcon,
  CalendarIcon,
  cleanError,
  ColorField,
  FontPicker,
  ImageIcon,
  RedoIcon,
  SaveIcon,
  Segmented,
  Slider,
  SmallButton,
  ToolButton,
  UndoIcon,
  WEIGHT_NAMES,
} from "../wall/WallStudio";

interface StudioOutput {
  deck: SlideDeck;
  urls: Record<string, string>;
}

interface SlideshowConfig {
  mentionBusiness?: boolean;
  images?: string;
  prompt?: string;
}

type Dialog = "swap" | "addImage" | "overlay" | "addSlide" | null;
type Panel = "dimensions" | "text" | "picture" | "overlay" | null;

/** The style half of a text box -- what "Apply to all slides" carries across the deck. */
const STYLE_KEYS = [
  "font",
  "weight",
  "size",
  "color",
  "stroke",
  "strokeColor",
  "background",
  "bgColor",
  "align",
  "width",
] as const satisfies readonly (keyof SlideText)[];

function stylePart(patch: Partial<SlideText>): Partial<SlideText> {
  const out: Partial<SlideText> = {};
  for (const k of STYLE_KEYS) if (k in patch) (out as Record<string, unknown>)[k] = patch[k];
  return out;
}

/** Undo keys for set swaps, which must never fold into one another. */
let themeSeq = 0;

/**
 * Which box of an `n`-box slide another slide's box `j` takes its style from:
 * the one in the same place in the stack, or the last. So a heading styles
 * headings and a body styles bodies, however many boxes each slide has.
 */
function counterpart(j: number, n: number): number {
  return Math.min(j, n - 1);
}

/**
 * Image Slideshow's editor: the job page while the run waits at its "edit"
 * gate.
 *
 * Everything is local until Save. Save approves the gate with the deck on
 * screen, and the export renders exactly that -- drawn by the same style
 * functions this preview uses. Schedule is Save, then the post composer once
 * the images exist.
 */
export function SlideshowStudio({
  jobId,
  config,
  output,
  onSaved,
}: {
  jobId: Id<"jobs">;
  config: SlideshowConfig;
  output: StudioOutput;
  onSaved?: (schedule: boolean) => void;
}) {
  const router = useRouter();
  const approve = useMutation(api.jobs.approveStep);
  const photosForDeck = useMutation(api.imageSets.forDeck);
  const brand = useQuery(api.brands.mine);

  const [deck, setDeck] = useState<SlideDeck>(output.deck);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Selection>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panel, setPanel] = useState<Panel>("text");
  const [applyAll, setApplyAll] = useState(false);
  /** The set chosen with "Use on every slide", once one is. */
  const [themeSet, setThemeSet] = useState<string | null>(null);
  const [saving, setSaving] = useState<"save" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = Math.min(index, deck.slides.length - 1);
  const slide = deck.slides[current];

  // ---- history: every change is undoable; a drag or a slider run is one step
  const live = useRef(deck);
  const history = useRef({ past: [] as SlideDeck[], future: [] as SlideDeck[], key: "", at: 0 });
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const sync = () => setDepth({ past: history.current.past.length, future: history.current.future.length });

  const update = useCallback((fn: (d: SlideDeck) => SlideDeck, key: string) => {
    const h = history.current;
    const now = Date.now();
    const fold = key === h.key && (key.startsWith("drag-") || key.startsWith("type-") || now - h.at < 1000);
    if (!fold) {
      h.past.push(live.current);
      if (h.past.length > 150) h.past.shift();
      h.future = [];
    }
    h.key = key;
    h.at = now;
    live.current = fn(live.current);
    setDeck(live.current);
    sync();
  }, []);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(live.current);
    h.key = "";
    live.current = prev;
    setDeck(prev);
    setEditingId(null);
    sync();
  }, []);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(live.current);
    h.key = "";
    live.current = next;
    setDeck(next);
    setEditingId(null);
    sync();
  }, []);

  // ---- per-slide helpers, always against the latest deck
  const editSlide = useCallback(
    (slideId: string, fn: (s: Slide) => Slide, key: string) =>
      update((d) => ({ ...d, slides: d.slides.map((s) => (s.id === slideId ? fn(s) : s)) }), key),
    [update],
  );

  const onText = useCallback(
    (id: string, patch: Partial<SlideText>, key: string) => {
      const style = stylePart(patch);
      // Apply-to-all carries style only: every box keeps its own words and
      // place, and takes the style of its counterpart on this slide.
      if (applyAll && Object.keys(style).length && !key.startsWith("drag-") && !key.startsWith("type-")) {
        update((d) => {
          const src = d.slides.find((s) => s.texts.some((t) => t.id === id));
          if (!src) return d;
          const i = src.texts.findIndex((t) => t.id === id);
          const n = src.texts.length;
          return {
            ...d,
            slides: d.slides.map((s) =>
              s === src
                ? { ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
                : { ...s, texts: s.texts.map((t, j) => (counterpart(j, n) === i ? { ...t, ...style } : t)) },
            ),
          };
        }, key);
        return;
      }
      update(
        (d) => ({
          ...d,
          slides: d.slides.map((s) =>
            s.texts.some((t) => t.id === id)
              ? { ...s, texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
              : s,
          ),
        }),
        key,
      );
    },
    [applyAll, update],
  );

  const onPicture = useCallback(
    (id: string, patch: Partial<SlidePicture>, key: string) =>
      update(
        (d) => ({
          ...d,
          slides: d.slides.map((s) =>
            s.pictures.some((p) => p.id === id)
              ? { ...s, pictures: s.pictures.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
              : s,
          ),
        }),
        key,
      ),
    [update],
  );

  const onOverlay = useCallback(
    (slideId: string, patch: Partial<SlideOverlay>, key: string) =>
      editSlide(slideId, (s) => (s.overlay ? { ...s, overlay: { ...s.overlay, ...patch } } : s), key),
    [editSlide],
  );

  /** Ticking "Apply to all slides": every slide's text takes this slide's style, now. */
  function styleAllLike(from: Slide) {
    const n = from.texts.length;
    if (!n) return;
    update(
      (d) => ({
        ...d,
        slides: d.slides.map((s) =>
          s.id === from.id
            ? s
            : { ...s, texts: s.texts.map((t, j) => ({ ...t, ...stylePart(from.texts[counterpart(j, n)]) })) },
        ),
      }),
      `apply-all-${Date.now()}`,
    );
  }

  /** Swap Image's "Use on every slide": a new photo on every slide from one set, and optionally its look. */
  async function useSetEverywhere(setId: string, restyle: boolean) {
    const slides = live.current.slides.map(
      (s) => s.texts.map((t) => t.text).join("\n").trim() || s.imagePrompt,
    );
    const photos = await photosForDeck({ set: setId, slides });
    setPickedUrls((m) => {
      const next = { ...m };
      for (const p of photos) if (p.url) next[p.assetId] = p.url;
      return next;
    });
    const style = restyle ? templateById(imageSetById(setId)?.style) : null;
    update(
      (d) => ({
        ...d,
        template: style?.id ?? d.template,
        slides: d.slides.map((s, i) => {
          const photo = photos[i];
          const next = photo ? { ...s, imageAssetId: photo.assetId } : s;
          return style ? restyleSlide(style, next, i === 0) : next;
        }),
      }),
      `theme-${++themeSeq}`,
    );
    setThemeSet(setId);
    setSelected(null);
    setEditingId(null);
    setDialog(null);
  }

  const selectedText =
    selected?.kind === "text" ? slide?.texts.find((t) => t.id === selected.id) : undefined;
  const selectedPicture =
    selected?.kind === "picture" ? slide?.pictures.find((p) => p.id === selected.id) : undefined;

  // Picking something on the slide opens its panel on the right.
  const select = useCallback((s: Selection) => {
    setSelected(s);
    if (s?.kind === "text") setPanel("text");
    if (s?.kind === "picture") setPanel("picture");
    if (s?.kind === "overlay") setPanel("overlay");
  }, []);

  function goTo(i: number) {
    setIndex(Math.max(0, Math.min(deck.slides.length - 1, i)));
    setSelected(null);
    setEditingId(null);
  }

  // ---- asset URLs: known at pick time, from the run, or resolved here
  const [pickedUrls, setPickedUrls] = useState<Record<string, string>>({});
  const known = { ...output.urls, ...pickedUrls };
  const missing = deckAssetIds(deck).filter((id) => !known[id]);
  const resolved = useQuery(
    api.assets.urlsFor,
    missing.length ? { assetIds: missing as Id<"assets">[] } : "skip",
  );
  const urls = useMemo(() => {
    const out = { ...output.urls, ...pickedUrls };
    for (const r of resolved ?? []) if (r?.url) out[r.id] = r.url;
    return out;
  }, [output.urls, pickedUrls, resolved]);
  const remember = (p: { assetId: string; url: string }) => setPickedUrls((m) => ({ ...m, [p.assetId]: p.url }));

  const deckImages = useMemo(
    () =>
      [...new Set(deck.slides.map((s) => s.imageAssetId).filter((x): x is string => Boolean(x)))]
        .map((id) => ({ id, url: urls[id] }))
        .filter((x): x is { id: string; url: string } => Boolean(x.url)),
    [deck.slides, urls],
  );

  // ---- actions on the deck
  function addText() {
    if (!slide || slide.texts.length >= MAX_TEXTS_PER_SLIDE) return;
    const like = selectedText ?? slide.texts[slide.texts.length - 1] ?? deck.slides.flatMap((s) => s.texts)[0];
    const last = slide.texts[slide.texts.length - 1];
    const t: SlideText = {
      ...DEFAULT_TEXT,
      ...(like ? stylePart(like) : {}),
      width: like?.width ?? DEFAULT_TEXT.width,
      id: newId("t"),
      text: "",
      x: 0.5,
      y: last ? Math.min(0.9, last.y + 0.12) : 0.5,
    };
    editSlide(slide.id, (s) => ({ ...s, texts: [...s.texts, t] }), `add-text-${t.id}`);
    setSelected({ kind: "text", id: t.id });
    setPanel("text");
    setEditingId(t.id);
  }

  function removeSelected() {
    if (!slide || !selected) return;
    if (selected.kind === "text") {
      editSlide(slide.id, (s) => ({ ...s, texts: s.texts.filter((t) => t.id !== selected.id) }), `rm-${Date.now()}`);
    } else if (selected.kind === "overlay") {
      editSlide(slide.id, (s) => ({ ...s, overlay: null }), `rm-${Date.now()}`);
    } else {
      editSlide(slide.id, (s) => ({ ...s, pictures: s.pictures.filter((p) => p.id !== selected.id) }), `rm-${Date.now()}`);
    }
    setSelected(null);
    setEditingId(null);
  }

  function deleteSlide() {
    if (deck.slides.length <= 1 || !slide) return;
    const id = slide.id;
    update((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== id) }), `rm-slide-${Date.now()}`);
    setIndex(Math.max(0, current - (current === deck.slides.length - 1 ? 1 : 0)));
    setSelected(null);
  }

  function moveSlide(from: number, to: number) {
    if (from === to) return;
    update((d) => {
      const slides = [...d.slides];
      const [s] = slides.splice(from, 1);
      slides.splice(to, 0, s);
      return { ...d, slides };
    }, `move-${Date.now()}`);
    setIndex(to);
  }

  function onImagePicked(p: PickedImage) {
    remember(p);
    if (!slide) return;
    if (dialog === "swap") {
      editSlide(
        slide.id,
        (s) => ({ ...s, imageAssetId: p.assetId, imagePrompt: p.prompt ?? s.imagePrompt }),
        `swap-${Date.now()}`,
      );
    } else if (dialog === "addImage") {
      if (slide.pictures.length >= MAX_PICTURES_PER_SLIDE) return;
      const pic: SlidePicture = { id: newId("p"), assetId: p.assetId, x: 0.5, y: 0.5, w: 0.56, radius: 28 };
      editSlide(slide.id, (s) => ({ ...s, pictures: [...s.pictures, pic] }), `add-pic-${pic.id}`);
      setSelected({ kind: "picture", id: pic.id });
      setPanel("picture");
    } else if (dialog === "addSlide") {
      if (deck.slides.length >= MAX_SLIDES) return;
      const like = slide.texts[slide.texts.length - 1] ?? deck.slides.flatMap((s) => s.texts)[0];
      const t: SlideText = {
        ...DEFAULT_TEXT,
        ...(like ? stylePart(like) : {}),
        width: like?.width ?? DEFAULT_TEXT.width,
        id: newId("t"),
        text: "",
        x: 0.5,
        y: like?.y ?? 0.5,
      };
      const fresh: Slide = {
        id: newId("s"),
        imageAssetId: p.assetId,
        imagePrompt: p.prompt ?? "",
        overlay: slide.overlay ? { ...slide.overlay } : null,
        pictures: [],
        texts: [t],
      };
      const at = current + 1;
      update((d) => {
        const slides = [...d.slides];
        slides.splice(at, 0, fresh);
        return { ...d, slides };
      }, `add-slide-${fresh.id}`);
      setIndex(at);
      setSelected({ kind: "text", id: t.id });
      setPanel("text");
      setEditingId(t.id);
    }
    setDialog(null);
  }

  // ---- keyboard: undo/redo, nudge, delete, slide paging -- never while typing
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") setSelected(null);
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
        return;
      }
      if (e.key === "Enter" && selected?.kind === "text") {
        e.preventDefault();
        setEditingId(selected.id);
        return;
      }
      const step = e.shiftKey ? 0.02 : 0.005;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = arrows[e.key];
      if (!delta) return;
      e.preventDefault();
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      if (!selected) {
        if (e.key === "ArrowLeft") goTo(current - 1);
        if (e.key === "ArrowRight") goTo(current + 1);
      } else if (selectedText) {
        onText(selectedText.id, { x: clamp(selectedText.x + delta[0]), y: clamp(selectedText.y + delta[1]) }, "nudge");
      } else if (selectedPicture) {
        onPicture(
          selectedPicture.id,
          { x: clamp(selectedPicture.x + delta[0]), y: clamp(selectedPicture.y + delta[1]) },
          "nudge",
        );
      } else if (selected.kind === "overlay" && slide?.overlay && !slide.overlay.fill) {
        onOverlay(slide.id, { x: clamp(slide.overlay.x + delta[0]), y: clamp(slide.overlay.y + delta[1]) }, "nudge");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save(schedule: boolean) {
    const empty = deck.slides.every((s) => !s.texts.some((t) => t.text.trim()) && !s.imageAssetId);
    if (empty) {
      setError("Add something to the slides before saving.");
      return;
    }
    setSaving(schedule ? "schedule" : "save");
    setError(null);
    setEditingId(null);
    try {
      await approve({ jobId, stepId: "edit", edits: { deck: live.current, urls: {} } });
      onSaved?.(schedule);
      if (schedule) router.replace(`/jobs/${jobId}?schedule=1`);
    } catch (e) {
      setError(cleanError(e));
      setSaving(null);
    }
  }

  // ---- the stage's size follows its column and the window's height
  const stageCol = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 420, h: 640 });
  useEffect(() => {
    const el = stageCol.current;
    if (!el) return;
    const measure = () =>
      setRoom({ w: el.clientWidth, h: Math.max(380, Math.min(760, window.innerHeight - 290)) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const frame = frameOf(deck.ratio);
  const stageWidth = Math.max(
    220,
    Math.min(room.w - 110, (room.h * frame.width) / frame.height, 460),
  );

  const palette = useMemo(() => {
    const brandColours = (brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    return [...new Set([...brandColours.map((c) => c.toUpperCase()), ...SLIDE_SWATCHES])];
  }, [brand]);

  if (!slide) return null;

  return (
    <div>
      {/* ---- header */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-2xl leading-none">📸</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Image Slideshow</h1>
          <p className="text-xs text-muted">Edit every slide, then save to export them as images.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            <SaveIcon />
            {saving === "save" ? "Saving…" : "Save slideshow"}
          </button>
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3.5 py-2 text-sm font-semibold text-accent hover:bg-accent hover:text-white disabled:opacity-60"
          >
            <CalendarIcon />
            {saving === "schedule" ? "Saving…" : "Schedule"}
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent">{error}</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
        <Summary
          config={config}
          images={themeSet ? setValue(themeSet) : config.images}
          brandName={brand?.name ?? null}
          deck={deck}
        />

        {/* ---- stage */}
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center gap-1 border-b border-line pb-2.5">
            <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!depth.past}>
              <UndoIcon />
            </ToolButton>
            <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!depth.future}>
              <RedoIcon />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <span className="font-mono text-xs tabular-nums text-muted">
              Slide {current + 1} / {deck.slides.length}
            </span>
            <span className="ml-auto hidden font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:block">
              Drag to move · double-click to type
            </span>
          </div>

          <div ref={stageCol} className="relative flex items-center justify-center gap-3 py-5">
            <NavButton side="left" disabled={current === 0} onClick={() => goTo(current - 1)} />
            <SlideStage
              key={`${slide.id}-${deck.ratio}`}
              slide={slide}
              ratio={deck.ratio}
              urls={urls}
              width={stageWidth}
              interactive
              selected={selected}
              editingId={editingId}
              onSelect={(s) => {
                select(s);
                if (!s || s.id !== editingId) setEditingId(null);
              }}
              onText={onText}
              onPicture={onPicture}
              onOverlay={(patch, key) => onOverlay(slide.id, patch, key)}
              onStartEdit={(id) => {
                setSelected({ kind: "text", id });
                setPanel("text");
                setEditingId(id);
              }}
              onEndEdit={() => setEditingId(null)}
              className="rounded-xl shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/10"
            />
            <NavButton side="right" disabled={current === deck.slides.length - 1} onClick={() => goTo(current + 1)} />
          </div>

          <div className="flex justify-center pb-3">
            <Dots count={deck.slides.length} current={current} onPick={goTo} />
          </div>

          <Filmstrip
            deck={deck}
            urls={urls}
            current={current}
            onPick={goTo}
            onMove={moveSlide}
            onAdd={() => setDialog("addSlide")}
          />
        </section>

        {/* ---- tools */}
        <aside className="self-start rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <MenuGroup
            icon={<ResizeIcon />}
            label="Dimensions"
            detail={deck.ratio}
            open={panel === "dimensions"}
            onToggle={() => setPanel(panel === "dimensions" ? null : "dimensions")}
          >
            <div className="grid grid-cols-4 gap-2">
              {SLIDE_RATIOS.map((r) => (
                <RatioButton
                  key={r}
                  ratio={r}
                  active={deck.ratio === r}
                  onClick={() => update((d) => ({ ...d, ratio: r }), `ratio-${Date.now()}`)}
                />
              ))}
            </div>
            <p className="text-xs text-muted">{RATIO_USES[deck.ratio]} · 1080×{frame.height}</p>
          </MenuGroup>

          <MenuGroup
            icon={<TextIcon />}
            label="Text"
            detail={selectedText ? "Selected" : `${slide.texts.length} on slide`}
            open={panel === "text"}
            onToggle={() => setPanel(panel === "text" ? null : "text")}
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-sub px-2.5 py-2 text-xs">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={(e) => {
                  setApplyAll(e.target.checked);
                  if (e.target.checked) styleAllLike(slide);
                }}
                className="size-3.5 accent-accent"
              />
              <span>
                <span className="font-medium">Apply to all slides</span>
                <span className="block text-[0.65rem] text-muted">
                  Every slide takes this slide&rsquo;s text style, and follows your changes while ticked
                </span>
              </span>
            </label>
            {selectedText ? (
              <TextInspector
                t={selectedText}
                palette={palette}
                onChange={(patch, key) => onText(selectedText.id, patch, key)}
                onRemove={removeSelected}
              />
            ) : (
              <TextList
                texts={slide.texts}
                onPick={(id) => setSelected({ kind: "text", id })}
                onAdd={addText}
              />
            )}
          </MenuGroup>

          {selectedPicture && (
            <MenuGroup
              icon={<ImageIcon />}
              label="Image"
              detail="Selected"
              open={panel === "picture"}
              onToggle={() => setPanel(panel === "picture" ? null : "picture")}
            >
              <Slider
                label="Size"
                value={Math.round(selectedPicture.w * 100)}
                min={5}
                max={100}
                display={`${Math.round(selectedPicture.w * 100)}%`}
                onChange={(w) => onPicture(selectedPicture.id, { w: w / 100 }, "pic-size")}
              />
              <Slider
                label="Corners"
                value={selectedPicture.radius}
                min={0}
                max={120}
                display={selectedPicture.radius ? `${selectedPicture.radius}px` : "Square"}
                onChange={(radius) => onPicture(selectedPicture.id, { radius }, "pic-radius")}
              />
              <div className="flex flex-wrap gap-2">
                <SmallButton onClick={() => onPicture(selectedPicture.id, { x: 0.5 }, `pic-centre-${Date.now()}`)}>
                  Centre
                </SmallButton>
                <SmallButton onClick={removeSelected}>Remove</SmallButton>
              </div>
            </MenuGroup>
          )}

          <MenuAction icon={<SwapIcon />} label="Swap Image" onClick={() => setDialog("swap")} />
          <MenuAction
            icon={<ImageIcon />}
            label="Add Images"
            onClick={() => setDialog("addImage")}
            disabled={slide.pictures.length >= MAX_PICTURES_PER_SLIDE}
          />
          <MenuAction
            icon={<TextIcon />}
            label="Add Text"
            onClick={addText}
            disabled={slide.texts.length >= MAX_TEXTS_PER_SLIDE}
          />
          {slide.overlay ? (
            <MenuGroup
              icon={<OverlayIcon />}
              label="Overlay"
              detail={
                slide.overlay.assetId
                  ? "Image"
                  : (OVERLAY_PRESETS.find((p) => p.id === slide.overlay?.preset)?.label ?? "")
              }
              open={panel === "overlay"}
              onToggle={() => setPanel(panel === "overlay" ? null : "overlay")}
            >
              {slide.overlay.assetId && (
                <FitToggle
                  fill={slide.overlay.fill}
                  onChange={(fill) => {
                    onOverlay(slide.id, { fill }, `overlay-fit-${Date.now()}`);
                    setSelected(fill ? null : { kind: "overlay", id: slide.id });
                  }}
                />
              )}
              <Slider
                label="Opacity"
                value={Math.round(slide.overlay.opacity * 100)}
                min={5}
                max={100}
                display={`${Math.round(slide.overlay.opacity * 100)}%`}
                onChange={(v) => onOverlay(slide.id, { opacity: v / 100 }, "overlay-opacity")}
              />
              {slide.overlay.assetId && !slide.overlay.fill && (
                <>
                  <Slider
                    label="Size"
                    value={Math.round(slide.overlay.w * 100)}
                    min={5}
                    max={200}
                    display={`${Math.round(slide.overlay.w * 100)}%`}
                    onChange={(w) => onOverlay(slide.id, { w: w / 100 }, "overlay-size")}
                  />
                  <Slider
                    label="Rotation"
                    value={Math.round(slide.overlay.rotation)}
                    min={-180}
                    max={180}
                    display={`${Math.round(slide.overlay.rotation)}°`}
                    onChange={(rotation) => onOverlay(slide.id, { rotation }, "overlay-rotation")}
                  />
                  <p className="text-[0.65rem] leading-snug text-muted">
                    Drag it on the slide. The corner handle resizes it, the top one rotates it.
                  </p>
                </>
              )}
              {slide.overlay.assetId && slide.overlay.fill && (
                <p className="text-[0.65rem] leading-snug text-muted">
                  Stretched over the whole slide. Choose Free to move, resize and rotate it.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {slide.overlay.assetId && !slide.overlay.fill && (
                  <>
                    <SmallButton
                      onClick={() => onOverlay(slide.id, { x: 0.5, y: 0.5 }, `overlay-centre-${Date.now()}`)}
                    >
                      Centre
                    </SmallButton>
                    <SmallButton
                      onClick={() => onOverlay(slide.id, { rotation: 0 }, `overlay-straight-${Date.now()}`)}
                    >
                      Straighten
                    </SmallButton>
                  </>
                )}
                <SmallButton onClick={() => setDialog("overlay")}>Change</SmallButton>
                <SmallButton
                  onClick={() => {
                    const o = slide.overlay;
                    update(
                      (d) => ({ ...d, slides: d.slides.map((s) => ({ ...s, overlay: o ? { ...o } : null })) }),
                      `overlay-all-${Date.now()}`,
                    );
                  }}
                >
                  Apply to all slides
                </SmallButton>
                <SmallButton
                  onClick={() => editSlide(slide.id, (s) => ({ ...s, overlay: null }), `overlay-rm-${Date.now()}`)}
                >
                  Remove
                </SmallButton>
              </div>
            </MenuGroup>
          ) : (
            <MenuAction icon={<OverlayIcon />} label="Add Overlay" onClick={() => setDialog("overlay")} />
          )}
          <MenuAction
            icon={<PlusIcon />}
            label="Add Slide"
            onClick={() => setDialog("addSlide")}
            disabled={deck.slides.length >= MAX_SLIDES}
          />
          <MenuAction
            icon={<TrashIcon />}
            label="Delete Slide"
            danger
            onClick={deleteSlide}
            disabled={deck.slides.length <= 1}
          />
        </aside>
      </div>

      {(dialog === "swap" || dialog === "addImage" || dialog === "addSlide") && (
        <ImageSourceDialog
          jobId={jobId}
          ratio={deck.ratio}
          title={dialog === "swap" ? "Swap image" : dialog === "addImage" ? "Add an image" : "Add a slide"}
          blurb={
            dialog === "swap"
              ? "Replace this slide's photo — or give every slide a new look from another image set. The text stays put."
              : dialog === "addImage"
                ? "Place a picture on this slide — a screenshot, a product shot, a second photo."
                : "A new slide after this one, with its own photo and a text box ready to type in."
          }
          initialPrompt={dialog === "swap" ? slide.imagePrompt : ""}
          defaultSet={
            themeSet ??
            (() => {
              const src = parseImageSource(config.images);
              return src.kind === "set" ? src.set.id : null;
            })()
          }
          deckImages={deckImages}
          checker={dialog === "addImage"}
          onPick={onImagePicked}
          onUseSet={dialog === "swap" ? useSetEverywhere : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "overlay" && (
        <OverlayDialog
          photoUrl={slide.imageAssetId ? (urls[slide.imageAssetId] ?? null) : null}
          onClose={() => setDialog(null)}
          onPick={(o) => {
            if ("assetId" in o) remember(o);
            editSlide(
              slide.id,
              (s) => ({
                ...s,
                overlay:
                  "assetId" in o
                    ? // A new image takes the old one's place, size and turn.
                      s.overlay?.assetId
                      ? { ...s.overlay, assetId: o.assetId }
                      : imageOverlay(o.assetId)
                    : presetOverlay(o.preset, o.preset === "grain" ? 0.35 : 0.55),
              }),
              `overlay-${Date.now()}`,
            );
            setPanel("overlay");
            if ("assetId" in o) setSelected({ kind: "overlay", id: slide.id });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary

function Summary({
  config,
  images,
  brandName,
  deck,
}: {
  config: SlideshowConfig;
  /** The images the deck is on now: the config's, or a set applied since. */
  images?: string;
  brandName: string | null;
  deck: SlideDeck;
}) {
  return (
    <section className="self-start rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold">Summary</h2>
        <Link href="/new/image-slideshow" className="text-xs text-muted hover:text-accent">
          ‹ New slideshow
        </Link>
      </div>
      <dl className="divide-y divide-line text-sm">
        <Row label="Mention your business">
          {config.mentionBusiness ? (brandName ? `Yes · ${brandName}` : "Yes") : "No"}
        </Row>
        <Row label="Images">
          <SourceSummary value={images} />
        </Row>
        <Row label="Slides">
          {deck.slides.length} · {deck.ratio}
        </Row>
        <div className="px-4 py-3">
          <dt className="text-xs font-medium text-muted">Prompt</dt>
          <dd className="mt-1 line-clamp-5 text-sm leading-snug">{config.prompt || "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- filmstrip

/** Every slide as a thumbnail: click to open, drag to reorder, + to add. */
function Filmstrip({
  deck,
  urls,
  current,
  onPick,
  onMove,
  onAdd,
}: {
  deck: SlideDeck;
  urls: Record<string, string>;
  current: number;
  onPick: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-line px-1 pb-1 pt-3">
      {deck.slides.map((s, i) => (
        <button
          key={s.id}
          type="button"
          draggable
          onDragStart={(e) => {
            setDragging(i);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging !== null) onMove(dragging, i);
            setDragging(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onClick={() => onPick(i)}
          title={`Slide ${i + 1} — drag to reorder`}
          className={[
            "relative shrink-0 overflow-hidden rounded-md ring-offset-2 ring-offset-surface transition",
            i === current ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-accent/60",
            over === i && dragging !== i ? "translate-x-1 ring-2 ring-accent/60" : "",
            dragging === i ? "opacity-40" : "",
          ].join(" ")}
        >
          <SlideStage slide={s} ratio={deck.ratio} urls={urls} width={54} />
          <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 font-mono text-[0.55rem] text-white">
            {i + 1}
          </span>
        </button>
      ))}
      {deck.slides.length < MAX_SLIDES && (
        <button
          type="button"
          onClick={onAdd}
          title="Add a slide"
          className="grid w-[54px] shrink-0 place-items-center rounded-md border border-dashed border-line text-lg text-muted hover:border-accent hover:text-accent"
          style={{ height: (54 * frameOf(deck.ratio).height) / frameOf(deck.ratio).width }}
        >
          +
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- text inspector

/**
 * Switching background carries the colours with it: white text on a white
 * highlight is invisible, and a Snapchat bar wants no outline. Only a colour
 * still at the other background's default is changed -- a chosen one stays.
 */
function withBackground(t: SlideText, bg: TextBackground): Partial<SlideText> {
  if (bg === "white") return { background: bg, stroke: 0, color: t.color === "#FFFFFF" ? "#111111" : t.color };
  if (bg === "color") {
    return { background: bg, stroke: 0, bgColor: t.bgColor === "#FFFFFF" ? "#FFE14D" : t.bgColor };
  }
  if (bg === "snapchat") return { background: bg, stroke: 0, color: t.color === "#111111" ? "#FFFFFF" : t.color };
  return t.background === "white" && t.color === "#111111"
    ? { background: bg, color: "#FFFFFF", stroke: 2, strokeColor: "#000000" }
    : { background: bg };
}

function TextInspector({
  t,
  palette,
  onChange,
  onRemove,
}: {
  t: SlideText;
  palette: string[];
  onChange: (patch: Partial<SlideText>, key: string) => void;
  onRemove: () => void;
}) {
  const weights = SLIDE_FONTS.find((f) => f.name === t.font)?.weights ?? [400];
  const weightIndex = Math.max(0, weights.indexOf(t.weight));
  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={t.text}
          maxLength={MAX_TEXT_CHARS}
          rows={3}
          onChange={(e) => onChange({ text: e.target.value }, `type-${t.id}`)}
          placeholder="Type here, or double-click the text on the slide"
          className="w-full resize-y rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm leading-snug outline-none focus:border-accent"
        />
        <div className="mt-1 flex items-center justify-between">
          <button type="button" onClick={onRemove} className="text-xs text-accent hover:underline">
            Delete text box
          </button>
          <span className="font-mono text-[0.65rem] tabular-nums text-muted">
            {t.text.length} / {MAX_TEXT_CHARS}
          </span>
        </div>
      </div>

      <Field label="Font">
        <FontPicker
          value={t.font}
          onChange={(font) => onChange({ font, weight: snapWeight(font, t.weight) }, `font-${Date.now()}`)}
        />
      </Field>
      <Slider
        label="Weight"
        value={weightIndex}
        min={0}
        max={weights.length - 1}
        display={WEIGHT_NAMES[t.weight] ?? String(t.weight)}
        disabled={weights.length < 2}
        onChange={(i) => onChange({ weight: weights[i] }, "weight")}
      />
      <Slider
        label="Size"
        value={t.size}
        min={16}
        max={180}
        display={`${t.size}px`}
        onChange={(size) => onChange({ size }, "size")}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Align</span>
        <Segmented
          value={t.align}
          onChange={(align) => onChange({ align }, `align-${Date.now()}`)}
          options={[
            { value: "left", label: <AlignIcon side="left" />, title: "Left" },
            { value: "center", label: <AlignIcon side="center" />, title: "Centre" },
            { value: "right", label: <AlignIcon side="right" />, title: "Right" },
          ]}
        />
      </div>

      <Field label="Colour">
        <ColorField value={t.color} palette={palette} onChange={(color) => onChange({ color }, "color")} />
      </Field>

      <Slider
        label="Stroke"
        value={t.stroke}
        min={0}
        max={12}
        step={0.5}
        display={t.stroke ? `${t.stroke}px` : "None"}
        onChange={(stroke) => onChange({ stroke }, "stroke")}
      />
      <div className={t.stroke ? "" : "pointer-events-none opacity-40"}>
        <Field label="Stroke colour">
          <ColorField
            value={t.strokeColor}
            palette={palette}
            onChange={(strokeColor) => onChange({ strokeColor }, "strokeColor")}
          />
        </Field>
      </div>

      <Field label="Background">
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ["none", "None"],
              ["white", "White"],
              ["snapchat", "Snapchat"],
              ["color", "Colour"],
            ] as const
          ).map(([bg, label]) => (
            <button
              key={bg}
              type="button"
              onClick={() => onChange(withBackground(t, bg), `bg-${Date.now()}`)}
              className={[
                "flex flex-col items-center gap-1 rounded-lg border p-1 text-[0.6rem]",
                t.background === bg
                  ? "border-accent bg-accent-soft font-semibold text-accent"
                  : "border-line text-muted hover:border-accent",
              ].join(" ")}
            >
              <span className="grid h-7 w-full place-items-center overflow-hidden rounded bg-[linear-gradient(135deg,#8a7a6f,#3b3440)]">
                {bg === "none" && (
                  <span className="text-xs font-semibold text-white [-webkit-text-stroke:1px_#000] [paint-order:stroke_fill]">
                    Aa
                  </span>
                )}
                {bg === "white" && <span className="rounded bg-white px-1 text-xs font-semibold text-[#111]">Aa</span>}
                {bg === "snapchat" && (
                  <span className="w-full bg-black/60 text-center text-xs font-medium text-white">Aa</span>
                )}
                {bg === "color" && (
                  <span className="rounded px-1 text-xs font-semibold" style={{ background: t.bgColor, color: t.color }}>
                    Aa
                  </span>
                )}
              </span>
              {label}
            </button>
          ))}
        </div>
      </Field>
      {t.background === "color" && (
        <Field label="Background colour">
          <ColorField value={t.bgColor} palette={palette} onChange={(bgColor) => onChange({ bgColor }, "bgColor")} />
        </Field>
      )}

      {t.background !== "snapchat" && (
        <Slider
          label="Box width"
          value={Math.round(t.width * 100)}
          min={20}
          max={100}
          display={`${Math.round(t.width * 100)}%`}
          onChange={(w) => onChange({ width: w / 100 }, "width")}
        />
      )}
    </div>
  );
}

/** An image overlay: stretched over the slide, or a box placed on it. */
function FitToggle({ fill, onChange }: { fill: boolean; onChange: (fill: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(
        [
          [false, "Free", "Move, resize and rotate"],
          [true, "Fill slide", "Cover the whole slide"],
        ] as const
      ).map(([value, label, hint]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(value)}
          className={[
            "rounded-lg border px-2 py-1.5 text-left text-xs",
            fill === value ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line hover:border-accent",
          ].join(" ")}
        >
          {label}
          <span className="block text-[0.6rem] font-normal text-muted">{hint}</span>
        </button>
      ))}
    </div>
  );
}

function TextList({
  texts,
  onPick,
  onAdd,
}: {
  texts: SlideText[];
  onPick: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Click a text box on the slide to style it, or pick one here.</p>
      {texts.map((t, i) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.id)}
          className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs hover:border-accent"
        >
          <span className="font-mono text-[0.6rem] text-muted">{i + 1}</span>
          <span className="line-clamp-1 flex-1" style={{ fontFamily: `"${t.font}", sans-serif` }}>
            {t.text || <em className="text-muted">Empty</em>}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="w-full rounded-lg border border-dashed border-line py-2 text-xs text-muted hover:border-accent hover:text-foreground"
      >
        + Add a text box
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- menu

function MenuGroup({
  icon,
  label,
  detail,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm hover:bg-surface-sub"
      >
        <span className="text-muted">{icon}</span>
        <span className="flex-1 font-medium">{label}</span>
        {detail && <span className="font-mono text-[0.62rem] text-muted">{detail}</span>}
        <span className={`text-xs text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

function MenuAction({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2.5 border-b border-line px-4 py-3 text-left text-sm last:border-b-0 hover:bg-surface-sub disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        danger ? "text-accent" : "",
      ].join(" ")}
    >
      <span className={danger ? "" : "text-muted"}>{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

function RatioButton({ ratio, active, onClick }: { ratio: SlideRatio; active: boolean; onClick: () => void }) {
  const f = frameOf(ratio);
  const h = 30;
  return (
    <button
      type="button"
      onClick={onClick}
      title={RATIO_USES[ratio]}
      className={[
        "flex flex-col items-center gap-1.5 rounded-lg border py-2 text-[0.65rem]",
        active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:border-accent",
      ].join(" ")}
    >
      <span className="grid h-[30px] place-items-end">
        <span
          className={`block rounded-[3px] border-[1.5px] ${active ? "border-accent" : "border-current"}`}
          style={{ width: (h * f.width) / f.height, height: h }}
        />
      </span>
      {ratio}
    </button>
  );
}

function NavButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-lg shadow-sm transition hover:border-accent hover:text-accent disabled:opacity-0"
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

// ---------------------------------------------------------------- icons

const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ResizeIcon() {
  return (
    <svg {...svg}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7V5h16v2M12 5v14M9 19h6" />
    </svg>
  );
}
function SwapIcon() {
  return (
    <svg {...svg}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}
function OverlayIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="3" width="13" height="13" rx="2" />
      <path d="M8 21h11a2 2 0 0 0 2-2V8" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}
