"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { clock, VideoTile } from "./HookField";
import { UploadIcon } from "./AvatarField";
import { useVideoUpload } from "./VideoLibrary";

/**
 * A video field chosen in a popup: one of the client's own videos, or a new
 * upload -- for the demo a hook + demo ad cuts to, which is usually the same
 * screen recording run after run, so re-uploading it every time was the
 * wrong default.
 *
 * Stores the bare asset id, exactly as the upload control it replaces did,
 * so nothing that reads the field changes.
 */
type Tab = "gallery" | "upload";
type LibraryVideo = NonNullable<ReturnType<typeof useVideos>>[number];

function useVideos() {
  return useQuery(api.assets.mediaLibrary, { kind: "video" });
}

export function DemoVideoField({
  value,
  onChange,
  label = "Demo video",
}: {
  value: unknown;
  onChange: (assetId: string | null) => void;
  label?: string;
}) {
  const id = typeof value === "string" && value ? value : null;
  const videos = useVideos();
  const [open, setOpen] = useState(false);
  const current = id ? videos?.find((v) => v.id === id) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5 text-left transition hover:border-accent"
      >
        {current?.url ? (
          <video
            src={`${current.url}#t=0.1`}
            poster={current.posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            className="aspect-[9/16] w-10 shrink-0 rounded-lg bg-black object-cover"
          />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <FilmIcon />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{id ? "Your demo video" : "Choose your demo video"}</span>
          <span className="block truncate text-xs text-muted">
            {id
              ? [current?.uploaded === false ? "Made here" : "Upload", current?.durationSec ? clock(current.durationSec) : null]
                  .filter(Boolean)
                  .join(" · ")
              : "From your gallery, or upload a new one"}
          </span>
        </span>
        <span className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs group-hover:border-accent">
          {id ? "Change" : "Choose"}
        </span>
      </button>
      {open && (
        <DemoDialog
          label={label}
          value={id}
          videos={videos}
          onClose={() => setOpen(false)}
          onPick={(assetId) => {
            onChange(assetId);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DemoDialog({
  label,
  value,
  videos,
  onClose,
  onPick,
}: {
  label: string;
  value: string | null;
  videos: LibraryVideo[] | undefined;
  onClose: () => void;
  onPick: (assetId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const [chosen, setChosen] = useState<string | null>(value);
  const [dragging, setDragging] = useState(false);
  // A new upload is what the user came for: it's applied straight away.
  const upload = useVideoUpload(onPick);

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

  const picked = chosen ? videos?.find((v) => v.id === chosen) : undefined;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[3px] sm:p-6" onPointerDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl animate-[quiz-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Choose your demo video</h2>
            <p className="mt-0.5 text-sm text-muted">
              What the hook cuts to: pick one from your gallery, or upload a new screen recording.
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

        <nav className="mt-4 flex shrink-0 gap-1 px-3 shadow-[inset_0_-1px_0_var(--line)] sm:px-5" role="tablist">
          {(
            [
              ["gallery", "From your gallery"],
              ["upload", "Upload new"],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                "border-b-2 px-3 py-2.5 text-sm transition",
                tab === id ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-foreground",
              ].join(" ")}
            >
              {text}
            </button>
          ))}
        </nav>

        <div className="min-h-[320px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {upload.error && <p className="mb-3 text-sm text-accent">{upload.error}</p>}
          {tab === "gallery" ? (
            videos === undefined ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <span key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-surface-sub" />
                ))}
              </div>
            ) : videos.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {videos.map((v) => (
                  <VideoTile
                    key={v.id}
                    url={v.url}
                    poster={v.posterUrl}
                    selected={chosen === v.id}
                    badge={v.uploaded ? "Upload" : "Made here"}
                    title="Your video"
                    sub={new Date(v.createdAt).toLocaleDateString()}
                    seconds={v.durationSec}
                    onSelect={() => setChosen(v.id)}
                    onUse={() => onPick(v.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted">
                No videos in your gallery yet.{" "}
                <button type="button" onClick={() => setTab("upload")} className="font-semibold text-accent underline">
                  Upload one
                </button>
              </p>
            )
          ) : (
            <button
              type="button"
              onClick={upload.pick}
              disabled={upload.busy}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) upload.uploadFile(file);
              }}
              className={[
                "flex min-h-[280px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 text-center transition disabled:opacity-60",
                dragging ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:border-accent hover:bg-accent-soft hover:text-accent",
              ].join(" ")}
            >
              <span className="grid size-12 place-items-center rounded-full bg-surface-sub">
                <UploadIcon />
              </span>
              <span className="text-sm font-semibold">
                {upload.busy ? "Uploading…" : "Drop a video here, or click to choose one"}
              </span>
              <span className="text-xs">Videos only · MP4, MOV or WebM. It’s kept in your gallery for next time.</span>
            </button>
          )}
          {upload.input}
        </div>

        {tab === "gallery" && (
          <footer className="shrink-0 border-t border-line px-5 py-3 sm:px-7">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{chosen ? "Your video" : "Nothing picked yet"}</p>
                <p className="truncate text-xs text-muted">
                  {picked
                    ? [picked.uploaded ? "Upload" : "Made here", picked.durationSec ? clock(picked.durationSec) : null]
                        .filter(Boolean)
                        .join(" · ")
                    : "Tap a video to watch it; double-click to use it straight away."}
                </p>
              </div>
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
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

function FilmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}
