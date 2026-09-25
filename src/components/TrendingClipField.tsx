"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * P9's picker: a compact card in the panel that opens a gallery popup over
 * the shared clip library, ingested ahead of time from `dev.ts`'s
 * `ingestTikTokClip` (no admin UI for triggering ingestion yet). Selecting a
 * clip stores its id in config, same as an upload stores an asset id; the
 * pipeline resolves it to a URL server-side when the job actually runs.
 *
 * A popup rather than an inline grid: a clip is judged by watching it, and a
 * 9:16 tile three to a row in a side panel is too small to watch.
 */
export type Clip = NonNullable<ReturnType<typeof useClips>>[number];

export function useClips() {
  return useQuery(api.clips.list, { limit: 100 });
}

export function TrendingClipField({
  value,
  onChange,
  label = "Trending video",
}: {
  value: unknown;
  onChange: (clipId: string | null) => void;
  /** The popup's title: the field's own label. */
  label?: string;
}) {
  const clips = useClips();
  const [open, setOpen] = useState(false);
  const picked = clips?.find((c) => c.id === value) ?? null;

  return (
    <>
      {picked ? (
        <div className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative h-16 w-9 shrink-0 overflow-hidden rounded-md bg-black"
            aria-label="Change video"
          >
            {picked.url && (
              <video src={`${picked.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
            )}
          </button>
          <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium">{clipName(picked)}</span>
            <span className="block truncate text-xs text-muted">
              {[clock(picked.durationSec), picked.tags.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs hover:border-accent"
          >
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface-sub p-3 text-left transition hover:border-accent"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <FilmIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Browse trending videos</span>
            <span className="block text-xs text-muted">
              {clips === undefined
                ? "Loading the library…"
                : clips.length
                  ? `${clips.length} clip${clips.length === 1 ? "" : "s"} in the library`
                  : "The library is empty so far"}
            </span>
          </span>
        </button>
      )}

      {open && (
        <TrendingDialog
          label={label}
          clips={clips}
          value={typeof value === "string" ? value : null}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- the popup

function TrendingDialog({
  label,
  clips,
  value,
  onClose,
  onPick,
}: {
  label: string;
  clips: Clip[] | undefined;
  value: string | null;
  onClose: () => void;
  onPick: (clipId: string | null) => void;
}) {
  // Choosing is two steps -- tap to watch it with sound, then "Use this
  // video" -- so trying a clip never costs the one already picked.
  const [chosen, setChosen] = useState<string | null>(value);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  const chosenClip = clips?.find((c) => c.id === chosen) ?? null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[3px] sm:p-6" onPointerDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl animate-[quiz-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
            <p className="mt-0.5 text-sm text-muted">
              Pick the clip that opens your video. Hover to preview, tap to watch it with sound.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-sub hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="mt-4 min-h-[320px] flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
          <TrendingGrid clips={clips} chosen={chosen} onSelect={setChosen} onUse={onPick} />
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-3 sm:px-7">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">
            {chosenClip ? (
              <>
                Selected: <span className="font-medium text-foreground">{clipName(chosenClip)}</span>
              </>
            ) : (
              "Nothing selected yet"
            )}
          </p>
          {value && (
            <button
              type="button"
              onClick={() => onPick(null)}
              className="rounded-full px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Clear
            </button>
          )}
          <button type="button" onClick={close} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent">
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen}
            onClick={() => chosen && onPick(chosen)}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_var(--accent)] hover:opacity-90 disabled:opacity-40"
          >
            Use this video
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The gallery itself -- tag chips over a grid of 9:16 tiles -- shared by
 * this popup and the hook popup's Trending tab. Tap selects (and plays with
 * sound); double-tap uses it outright.
 */
export function TrendingGrid({
  clips,
  chosen,
  onSelect,
  onUse,
}: {
  clips: Clip[] | undefined;
  chosen: string | null;
  onSelect: (clipId: string) => void;
  onUse: (clipId: string) => void;
}) {
  const [tag, setTag] = useState<string | null>(null);

  // The most common tags first, as filter chips.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clips ?? []) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [clips]);

  if (clips === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-surface-sub" />
        ))}
      </div>
    );
  }
  if (!clips.length) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong px-5 py-16 text-center">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <FilmIcon />
        </span>
        <p className="mt-3 text-sm font-medium">No trending videos yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
          Clips appear here once whoever runs the deployment ingests a few trending videos.
        </p>
      </div>
    );
  }

  const shown = clips.filter((c) => !tag || c.tags.includes(tag));
  return (
    <div className="space-y-4">
      {tags.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[null, ...tags].map((t) => (
            <button
              key={t ?? "all"}
              type="button"
              onClick={() => setTag(t)}
              className={[
                "shrink-0 rounded-full border px-3 py-1.5 text-xs transition",
                tag === t ? "border-accent bg-accent text-white" : "border-line hover:border-accent",
              ].join(" ")}
            >
              {t ?? "All"}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {shown.map((c) => (
          <ClipTile
            key={c.id}
            clip={c}
            selected={chosen === c.id}
            onSelect={() => onSelect(c.id)}
            onUse={() => onUse(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ClipTile({
  clip,
  selected,
  onSelect,
  onUse,
}: {
  clip: Clip;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onUse}
      aria-pressed={selected}
      className={[
        "group relative overflow-hidden rounded-2xl text-left transition",
        selected ? "ring-[3px] ring-accent" : "ring-1 ring-line hover:ring-accent",
      ].join(" ")}
    >
      {clip.url ? (
        <video
          // Remounted on select so the chosen tile restarts unmuted.
          key={selected ? "on" : "off"}
          src={selected ? clip.url : `${clip.url}#t=0.1`}
          muted={!selected}
          autoPlay={selected}
          loop
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full bg-black object-cover"
          onMouseEnter={(e) => !selected && void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
            if (selected) return;
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0.1;
          }}
        />
      ) : (
        <div className="aspect-[9/16] w-full bg-line-strong" />
      )}

      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-8 text-white">
        <span className="block truncate text-xs font-medium">{clipName(clip)}</span>
        {clip.tags.length > 0 && (
          <span className="block truncate text-[0.65rem] opacity-80">{clip.tags.slice(0, 3).join(" · ")}</span>
        )}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 font-mono text-[0.6rem] text-white">
        {clock(clip.durationSec)}
      </span>
      {selected && (
        <span className="pointer-events-none absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-accent text-white shadow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5 10 17 19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- helpers

export function clipName(c: Clip): string {
  return c.creatorHandle ? `@${c.creatorHandle}` : c.source;
}

function clock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function FilmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18" />
    </svg>
  );
}
