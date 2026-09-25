"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  LOOKS,
  MAX_TEXT_CHARS,
  SWATCHES,
  snapWeight,
  WALL_FONTS,
  type TextBackground,
  type WallDesign,
} from "../../../convex/lib/wallOfTextDesign";
import { WallStage, type Selection } from "./WallStage";
import { ImagePickerDialog } from "./ImagePickerDialog";
import { useGoogleFont } from "./useGoogleFont";

interface StudioOutput {
  design: WallDesign;
  videoUrl: string | null;
  audioUrl: string | null;
  /** Loop the preview at this many seconds: the part of the clip the video uses. */
  previewSeconds?: number | null;
}

/**
 * What makes this studio another format's -- Video Hook & Demo edits its
 * hook caption here. Omitted, it is Wall of Text's own.
 */
export interface StudioVariant {
  icon: string;
  title: string;
  hint: string;
  /** The left-hand column. */
  summary: React.ReactNode;
  /** The rewrite button's name and what it does to the text as it stands. */
  rewriteLabel: string;
  rewrite: (current: string) => Promise<string>;
  /** A word count to aim for, counted under the text box instead of characters. */
  words?: { min: number; max: number };
  /** Whether an overlay image can be added. */
  overlays: boolean;
}

interface WallConfig {
  mentionBusiness?: boolean;
  video?: string;
  audio?: string | null;
  prompt?: string;
}

/**
 * Wall of Text's studio: the job page while the run waits at its "style" gate.
 * Video Hook & Demo's caption editor is the same studio, as a `variant`.
 *
 * Everything here is local until Save. Save approves the gate with the design
 * on screen, and the render burns in exactly that -- drawn by the same style
 * functions this preview uses. Schedule is Save plus opening the post composer
 * once the video exists.
 */
export function WallStudio({
  jobId,
  config,
  output,
  onSaved,
  variant,
}: {
  jobId: Id<"jobs">;
  config: WallConfig;
  output: StudioOutput;
  /** Told whether the save was a Schedule, so the job view can open the composer when the render lands. */
  onSaved?: (schedule: boolean) => void;
  variant?: StudioVariant;
}) {
  const router = useRouter();
  const approve = useMutation(api.jobs.approveStep);
  const wallRewrite = useAction(api.wallOfText.rewrite);
  const overlays = variant?.overlays ?? true;
  const brand = useQuery(api.brands.mine);

  const [design, setDesign] = useState<WallDesign>(output.design);
  const [selected, setSelected] = useState<Selection>("text");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<"save" | "schedule" | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // ---- history: every change is undoable; a drag or a slider run is one step
  const current = useRef(design);
  const history = useRef({ past: [] as WallDesign[], future: [] as WallDesign[], key: "", at: 0 });
  // What the undo/redo buttons render from; the stacks themselves live in the ref.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const sync = () =>
    setDepth({ past: history.current.past.length, future: history.current.future.length });

  const update = useCallback((patch: Partial<WallDesign>, key: string) => {
    const h = history.current;
    const now = Date.now();
    const fold = key === h.key && (key.startsWith("drag-") || now - h.at < 1000);
    if (!fold) {
      h.past.push(current.current);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
    }
    h.key = key;
    h.at = now;
    current.current = { ...current.current, ...patch };
    setDesign(current.current);
    sync();
  }, []);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(current.current);
    h.key = "";
    current.current = prev;
    setDesign(prev);
    sync();
  }, []);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(current.current);
    h.key = "";
    current.current = next;
    setDesign(next);
    sync();
  }, []);

  // ---- overlay preview URL: known at pick time, resolved for a reopened design
  const [pickedUrls, setPickedUrls] = useState<Record<string, string>>({});
  const overlayId = design.overlay?.assetId ?? null;
  const resolved = useQuery(
    api.assets.urlsFor,
    overlayId && !pickedUrls[overlayId] ? { assetIds: [overlayId as Id<"assets">] } : "skip",
  );
  const overlayUrl = overlayId ? (pickedUrls[overlayId] ?? resolved?.[0]?.url ?? null) : null;

  // ---- keyboard: undo/redo, nudge, delete, deselect -- never while typing
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
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
      const d = current.current;
      if ((e.key === "Delete" || e.key === "Backspace") && selected === "overlay") {
        e.preventDefault();
        update({ overlay: null }, "overlay-remove");
        setSelected("text");
      }
      const step = e.shiftKey ? 0.02 : 0.005;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = arrows[e.key];
      if (delta && selected) {
        e.preventDefault();
        const clamp = (n: number) => Math.min(1, Math.max(0, n));
        if (selected === "text") {
          update({ x: clamp(d.x + delta[0]), y: clamp(d.y + delta[1]) }, "nudge");
        } else if (d.overlay) {
          update(
            { overlay: { ...d.overlay, x: clamp(d.overlay.x + delta[0]), y: clamp(d.overlay.y + delta[1]) } },
            "nudge",
          );
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo, update, selected]);

  async function anotherTake() {
    setRewriting(true);
    setError(null);
    try {
      const text = variant
        ? await variant.rewrite(current.current.text)
        : (await wallRewrite({ jobId, current: current.current.text })).text;
      update({ text }, `rewrite-${Date.now()}`);
      setSelected("text");
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setRewriting(false);
    }
  }

  async function save(schedule: boolean) {
    if (!design.text.trim()) {
      setError("Add some text before saving.");
      setSelected("text");
      return;
    }
    setSaving(schedule ? "schedule" : "save");
    setError(null);
    try {
      await approve({ jobId, stepId: "style", edits: { ...output, design: current.current } });
      // The job view opens the composer by itself once the render lands. The
      // URL carries the intent too, so a reload while rendering keeps it.
      onSaved?.(schedule);
      if (schedule) router.replace(`/jobs/${jobId}?schedule=1`);
    } catch (e) {
      setError(cleanError(e));
      setSaving(null);
    }
  }

  // ---- the stage's size follows its column, up to phone-ish
  const stageCol = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(340);
  useEffect(() => {
    const el = stageCol.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setStageWidth(Math.max(240, Math.min(360, w - 8)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const palette = useMemo(() => {
    const brandColours = (brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
    return [...new Set([...brandColours.map((c) => c.toUpperCase()), ...SWATCHES])];
  }, [brand]);

  return (
    <div>
      {/* ---- header: where you are, and the two ways out */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="text-2xl leading-none">{variant?.icon ?? "🔠"}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">{variant?.title ?? "Wall of Text"}</h1>
          <p className="text-xs text-muted">{variant?.hint ?? "Style and place your text, then save to render."}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            <SaveIcon />
            {saving === "save" ? "Saving…" : "Save video"}
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
        <p className="mt-4 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
        {variant?.summary ?? (
          <Summary
            config={config}
            brandName={brand?.name ?? null}
            audioUrl={output.audioUrl}
            videoUrl={output.videoUrl}
          />
        )}

        {/* ---- stage */}
        <section className="rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center gap-1 border-b border-line pb-2.5">
            <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!depth.past}>
              <UndoIcon />
            </ToolButton>
            <ToolButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!depth.future}>
              <RedoIcon />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" />
            <ToolButton
              label={variant ? variant.rewriteLabel : "Another take on the text"}
              onClick={anotherTake}
              disabled={rewriting}
              active={rewriting}
            >
              <ShuffleIcon spinning={rewriting} />
            </ToolButton>
            {overlays && (
              <ToolButton label="Add an overlay image" onClick={() => setPicking(true)}>
                <ImageIcon />
              </ToolButton>
            )}
            <span className="ml-auto hidden font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:block">
              Drag to move · double-click to edit
            </span>
          </div>
          <div ref={stageCol} className="flex justify-center py-5">
            <WallStage
              design={design}
              videoUrl={output.videoUrl}
              audioUrl={output.audioUrl}
              overlayUrl={overlayUrl}
              maxSeconds={output.previewSeconds}
              width={stageWidth}
              interactive
              selected={selected}
              onSelect={setSelected}
              onChange={update}
              onEditText={() => {
                setSelected("text");
                requestAnimationFrame(() => textRef.current?.focus());
              }}
            />
          </div>
        </section>

        {/* ---- inspector */}
        <aside className="rounded-2xl border border-line bg-surface lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          {selected === "overlay" && design.overlay ? (
            <OverlayInspector
              design={design}
              overlayUrl={overlayUrl}
              update={update}
              onReplace={() => setPicking(true)}
              onDone={() => setSelected("text")}
            />
          ) : selected === "text" ? (
            <TextInspector
              design={design}
              update={update}
              palette={palette}
              textRef={textRef}
              rewriting={rewriting}
              onRewrite={anotherTake}
              rewriteLabel={variant?.rewriteLabel ?? "Another take"}
              words={variant?.words}
              overlays={overlays}
              overlayUrl={overlayUrl}
              onPickOverlay={() => setPicking(true)}
              onSelectOverlay={() => setSelected("overlay")}
            />
          ) : (
            <div className="p-5 text-center">
              <p className="text-sm font-medium">Nothing selected</p>
              <p className="mt-1 text-xs text-muted">Click the text or an overlay on the video to style it.</p>
              <button
                type="button"
                onClick={() => setSelected("text")}
                className="mt-4 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent"
              >
                Edit the text
              </button>
            </div>
          )}
        </aside>
      </div>

      {picking && (
        <ImagePickerDialog
          onClose={() => setPicking(false)}
          onPick={(assetId, url) => {
            setPickedUrls((m) => ({ ...m, [assetId]: url }));
            const prev = current.current.overlay;
            update(
              { overlay: { assetId, x: prev?.x ?? 0.5, y: prev?.y ?? 0.2, w: prev?.w ?? 0.3 } },
              `overlay-${Date.now()}`,
            );
            setSelected("overlay");
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary

function Summary({
  config,
  brandName,
  audioUrl,
  videoUrl,
}: {
  config: WallConfig;
  brandName: string | null;
  audioUrl: string | null;
  /** The clip the text goes on -- picked, or filmed by this run. */
  videoUrl: string | null;
}) {
  const audio = config.audio ?? null;
  const filmed = Boolean(config.video && !/^(clip|video):/.test(config.video));
  return (
    <section className="self-start rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold">Summary</h2>
        <Link href="/new/wall-of-text" className="text-xs text-muted hover:text-accent">
          ‹ New video
        </Link>
      </div>
      <dl className="divide-y divide-line text-sm">
        <Row label="Mention your business">
          {config.mentionBusiness ? (brandName ? `Yes · ${brandName}` : "Yes") : "No"}
        </Row>
        <Row label={filmed ? "Video · filmed for you" : "Video"}>
          {videoUrl ? (
            <video
              src={videoUrl}
              muted
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-9 rounded-md bg-black object-cover"
            />
          ) : (
            <span className="text-muted">—</span>
          )}
        </Row>
        <Row label="Audio">
          {audio && audioUrl ? (
            <span className="inline-flex items-center gap-1.5">
              <MusicIcon /> {audio.startsWith("template:") ? "Library track" : "Your upload"}
            </span>
          ) : (
            "Original sound"
          )}
        </Row>
        <div className="px-4 py-3">
          <dt className="text-xs font-medium text-muted">Prompt</dt>
          <dd className="mt-1 line-clamp-4 text-sm leading-snug">{config.prompt || "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- inspectors

type Update = (patch: Partial<WallDesign>, key: string) => void;

export const WEIGHT_NAMES: Record<number, string> = {
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

/**
 * Switching background carries the colours with it: white text on a white
 * highlight is invisible, and a Snapchat bar wants no outline. Only a colour
 * still at the other background's default is changed -- a chosen one stays.
 */
function withBackground(d: WallDesign, bg: TextBackground): Partial<WallDesign> {
  if (bg === "white") {
    return { background: bg, stroke: 0, color: d.color === "#FFFFFF" ? "#111111" : d.color };
  }
  if (bg === "snapchat") {
    return { background: bg, stroke: 0, color: d.color === "#111111" ? "#FFFFFF" : d.color };
  }
  return d.background === "white" && d.color === "#111111"
    ? { background: bg, color: "#FFFFFF", stroke: 3, strokeColor: "#000000" }
    : { background: bg };
}

function TextInspector({
  design,
  update,
  palette,
  textRef,
  rewriting,
  onRewrite,
  rewriteLabel,
  words,
  overlays,
  overlayUrl,
  onPickOverlay,
  onSelectOverlay,
}: {
  design: WallDesign;
  update: Update;
  palette: string[];
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  rewriting: boolean;
  onRewrite: () => void;
  rewriteLabel: string;
  words?: { min: number; max: number };
  overlays: boolean;
  overlayUrl: string | null;
  onPickOverlay: () => void;
  onSelectOverlay: () => void;
}) {
  const weights = WALL_FONTS.find((f) => f.name === design.font)?.weights ?? [400];
  const weightIndex = Math.max(0, weights.indexOf(design.weight));

  return (
    <div className="divide-y divide-line">
      <Section title="Text">
        <textarea
          ref={textRef}
          value={design.text}
          maxLength={MAX_TEXT_CHARS}
          rows={5}
          onChange={(e) => update({ text: e.target.value }, "text")}
          className="w-full resize-y rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm leading-snug outline-none focus:border-accent"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <button
            type="button"
            onClick={onRewrite}
            disabled={rewriting}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-60"
          >
            <ShuffleIcon spinning={rewriting} small />
            {rewriting ? "Writing…" : rewriteLabel}
          </button>
          {words ? (
            <WordCount text={design.text} {...words} />
          ) : (
            <span className="font-mono text-[0.65rem] tabular-nums text-muted">
              {design.text.length} / {MAX_TEXT_CHARS}
            </span>
          )}
        </div>
      </Section>

      <Section title="Colours">
        <div className="grid grid-cols-5 gap-1.5">
          {LOOKS.map((look) => {
            const preview = { ...design, ...look.patch };
            return (
              <button
                key={look.id}
                type="button"
                title={look.label}
                onClick={() => update(look.patch, `look-${look.id}-${Date.now()}`)}
                className="group flex flex-col items-center gap-1"
              >
                <span className="grid h-10 w-full place-items-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,#8a7a6f,#3b3440)] ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent">
                  <LookSwatch d={preview} />
                </span>
                <span className="text-[0.6rem] text-muted">{look.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Font">
        <FontPicker
          value={design.font}
          onChange={(font) =>
            update({ font, weight: snapWeight(font, design.weight) }, `font-${Date.now()}`)
          }
        />
        <Slider
          label="Weight"
          value={weightIndex}
          min={0}
          max={weights.length - 1}
          display={WEIGHT_NAMES[design.weight] ?? String(design.weight)}
          disabled={weights.length < 2}
          onChange={(i) => update({ weight: weights[i] }, "weight")}
        />
        <Slider
          label="Size"
          value={design.size}
          min={20}
          max={140}
          display={`${design.size}px`}
          onChange={(size) => update({ size }, "size")}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Align</span>
          <Segmented
            value={design.align}
            onChange={(align) => update({ align }, `align-${Date.now()}`)}
            options={[
              { value: "left", label: <AlignIcon side="left" />, title: "Left" },
              { value: "center", label: <AlignIcon side="center" />, title: "Centre" },
              { value: "right", label: <AlignIcon side="right" />, title: "Right" },
            ]}
          />
        </div>
      </Section>

      <Section title="Colour">
        <ColorField
          value={design.color}
          palette={palette}
          onChange={(color) => update({ color }, "color")}
        />
      </Section>

      <Section title="Stroke">
        <Slider
          label="Width"
          value={design.stroke}
          min={0}
          max={12}
          step={0.5}
          display={design.stroke ? `${design.stroke}px` : "None"}
          onChange={(stroke) => update({ stroke }, "stroke")}
        />
        <div className={design.stroke ? "" : "pointer-events-none opacity-40"}>
          <p className="mb-1.5 text-xs font-medium text-muted">Stroke colour</p>
          <ColorField
            value={design.strokeColor}
            palette={palette}
            onChange={(strokeColor) => update({ strokeColor }, "strokeColor")}
          />
        </div>
      </Section>

      <Section title="Background">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["none", "None"],
              ["white", "White"],
              ["snapchat", "Snapchat"],
            ] as const
          ).map(([bg, label]) => (
            <button
              key={bg}
              type="button"
              onClick={() => update(withBackground(design, bg), `bg-${Date.now()}`)}
              className={[
                "flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[0.65rem]",
                design.background === bg
                  ? "border-accent bg-accent-soft font-semibold text-accent"
                  : "border-line text-muted hover:border-accent",
              ].join(" ")}
            >
              <span className="grid h-8 w-full place-items-center overflow-hidden rounded bg-[linear-gradient(135deg,#8a7a6f,#3b3440)]">
                {bg === "none" && (
                  <span className="text-sm font-semibold text-white [-webkit-text-stroke:1px_#000] [paint-order:stroke_fill]">
                    Aa
                  </span>
                )}
                {bg === "white" && (
                  <span className="rounded bg-white px-1.5 text-sm font-semibold text-[#111]">Aa</span>
                )}
                {bg === "snapchat" && (
                  <span className="w-full bg-black/60 text-center text-sm font-medium text-white">Aa</span>
                )}
              </span>
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Position">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["Top", 0.2],
              ["Middle", 0.42],
              ["Lower", 0.66],
            ] as const
          ).map(([label, y]) => (
            <button
              key={label}
              type="button"
              onClick={() => update({ y, x: 0.5 }, `pos-${Date.now()}`)}
              className="rounded-lg border border-line py-1.5 text-xs text-muted hover:border-accent hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
        <Slider
          label="Width"
          value={Math.round(design.width * 100)}
          min={30}
          max={100}
          display={`${Math.round(design.width * 100)}%`}
          onChange={(w) => update({ width: w / 100 }, "width")}
        />
      </Section>

      {overlays && (
      <Section title="Overlay image">
        {design.overlay ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSelectOverlay}
              className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-sub hover:border-accent"
            >
              {overlayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={overlayUrl} alt="" className="size-full object-contain" />
              ) : null}
            </button>
            <div className="flex flex-1 flex-wrap gap-2">
              <SmallButton onClick={onSelectOverlay}>Adjust</SmallButton>
              <SmallButton onClick={onPickOverlay}>Replace</SmallButton>
              <SmallButton onClick={() => update({ overlay: null }, `overlay-${Date.now()}`)}>
                Remove
              </SmallButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onPickOverlay}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-3 text-xs text-muted hover:border-accent hover:text-foreground"
          >
            <ImageIcon /> Choose from library or upload
          </button>
        )}
      </Section>
      )}
    </div>
  );
}

/** "11 words · 10–12", in the accent colour once it's outside the range. */
function WordCount({ text, min, max }: { text: string; min: number; max: number }) {
  const n = text.trim().match(/\S+/g)?.length ?? 0;
  const off = n > 0 && (n < min || n > max);
  return (
    <span
      className={`font-mono text-[0.65rem] tabular-nums ${off ? "text-accent" : "text-muted"}`}
      title={`Aim for ${min}–${max} words`}
    >
      {n} {n === 1 ? "word" : "words"} · {min}–{max}
    </span>
  );
}

function OverlayInspector({
  design,
  overlayUrl,
  update,
  onReplace,
  onDone,
}: {
  design: WallDesign;
  overlayUrl: string | null;
  update: Update;
  onReplace: () => void;
  onDone: () => void;
}) {
  const o = design.overlay!;
  return (
    <div className="divide-y divide-line">
      <Section title="Overlay image">
        <div className="grid h-32 place-items-center overflow-hidden rounded-lg border border-line bg-[conic-gradient(#e7e1e5_25%,#fff_0_50%,#e7e1e5_0_75%,#fff_0)] bg-[length:16px_16px]">
          {overlayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={overlayUrl} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted">Loading…</span>
          )}
        </div>
        <Slider
          label="Size"
          value={Math.round(o.w * 100)}
          min={5}
          max={100}
          display={`${Math.round(o.w * 100)}%`}
          onChange={(w) => update({ overlay: { ...o, w: w / 100 } }, "overlay-size")}
        />
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => update({ overlay: { ...o, x: 0.5 } }, `ov-centre-${Date.now()}`)}>
            Centre
          </SmallButton>
          <SmallButton onClick={onReplace}>Replace</SmallButton>
          <SmallButton
            onClick={() => {
              update({ overlay: null }, `overlay-${Date.now()}`);
              onDone();
            }}
          >
            Remove
          </SmallButton>
        </div>
        <p className="text-xs text-muted">Drag it on the video to move it; drag the corner dot to resize.</p>
      </Section>
      <div className="p-4">
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-lg border border-line py-2 text-xs hover:border-accent"
        >
          ← Back to text
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- controls

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 px-4 py-3.5">
      <h3 className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className={`block ${disabled ? "opacity-50" : ""}`}>
      <span className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-muted">{label}</span>
        <span className="font-mono tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

export function ColorField({
  value,
  palette,
  onChange,
}: {
  value: string;
  palette: string[];
  onChange: (hex: string) => void;
}) {
  // Only holds a half-typed hex while the field is being edited; otherwise
  // the field shows the value itself, so a swatch click updates it at once.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={[
              "size-6 rounded-full border transition",
              value.toUpperCase() === c
                ? "border-accent ring-2 ring-accent ring-offset-1 ring-offset-surface"
                : "border-line-strong hover:scale-110",
            ].join(" ")}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded-md border border-line bg-surface-sub p-0.5"
          aria-label="Pick a custom colour"
        />
        <input
          type="text"
          value={draft ?? value}
          maxLength={7}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setDraft(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase());
          }}
          className="w-24 rounded-md border border-line bg-surface-sub px-2 py-1 font-mono text-xs uppercase outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-sub p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={[
            "grid h-7 w-8 place-items-center rounded-md",
            value === o.value ? "bg-surface text-accent shadow-sm" : "text-muted hover:text-foreground",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Every family at its regular weight, so the list can show each name in its own face. */
const ALL_FONTS_HREF = `https://fonts.googleapis.com/css2?${WALL_FONTS.map(
  (f) => `family=${f.name.replace(/ /g, "+")}`,
).join("&")}&display=swap`;

export function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [open, setOpen] = useState(false);
  useGoogleFont(open ? ALL_FONTS_HREF : null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm hover:border-accent"
        style={{ fontFamily: `"${value}", sans-serif` }}
      >
        {value}
        <span className="text-xs text-muted">▾</span>
      </button>
      {open && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl">
          {WALL_FONTS.map((f) => (
            <li key={f.name}>
              <button
                type="button"
                onClick={() => {
                  onChange(f.name);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[0.95rem]",
                  f.name === value ? "bg-accent-soft text-accent" : "hover:bg-surface-sub",
                ].join(" ")}
                style={{ fontFamily: `"${f.name}", sans-serif` }}
              >
                {f.name}
                {f.weights.length > 1 && (
                  <span className="font-sans text-[0.6rem] text-muted">{f.weights.length} weights</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LookSwatch({ d }: { d: WallDesign }) {
  const text = (
    <span
      style={{
        color: d.color,
        fontWeight: d.weight,
        fontSize: 13,
        WebkitTextStroke: d.stroke ? `${Math.min(d.stroke, 4) / 2}px ${d.strokeColor}` : undefined,
        paintOrder: "stroke fill",
        ...(d.background === "white"
          ? { background: "#fff", padding: "0 5px", borderRadius: 4 }
          : {}),
      }}
    >
      Aa
    </span>
  );
  return d.background === "snapchat" ? (
    <span className="w-full bg-black/60 text-center">{text}</span>
  ) : (
    text
  );
}

export function ToolButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        "grid size-8 place-items-center rounded-lg transition",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-sub hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent"
    >
      {children}
    </button>
  );
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Convex wraps a thrown Error as "[CONVEX ...] ... Uncaught Error: <msg>\n  at ...".
  const m = /Uncaught Error: ([^\n]+)/.exec(msg);
  return m ? m[1] : msg;
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

export function SaveIcon() {
  return (
    <svg {...svg}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </svg>
  );
}
export function CalendarIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
    </svg>
  );
}
export function UndoIcon() {
  return (
    <svg {...svg}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}
export function RedoIcon() {
  return (
    <svg {...svg}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </svg>
  );
}
export function ShuffleIcon({ spinning, small }: { spinning?: boolean; small?: boolean }) {
  return (
    <svg {...svg} width={small ? 13 : 16} height={small ? 13 : 16} className={spinning ? "animate-spin" : ""}>
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}
export function ImageIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m3.5 15.5 4.2-4.2a2 2 0 0 1 2.8 0l5 5" />
      <circle cx="15.5" cy="9" r="1.5" />
    </svg>
  );
}
function MusicIcon() {
  return (
    <svg {...svg} width={13} height={13}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
export function AlignIcon({ side }: { side: "left" | "center" | "right" }) {
  const lines =
    side === "left"
      ? ["M4 6h16", "M4 10h10", "M4 14h16", "M4 18h10"]
      : side === "center"
        ? ["M4 6h16", "M7 10h10", "M4 14h16", "M7 18h10"]
        : ["M4 6h16", "M10 10h10", "M4 14h16", "M10 18h10"];
  return (
    <svg {...svg} width={14} height={14}>
      {lines.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
