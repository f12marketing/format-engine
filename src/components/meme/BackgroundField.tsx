"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { clock } from "../HookField";
import { useMediaUpload } from "./useMediaUpload";
import { DropZone, PickedTick, PickerDialog, TabButton } from "./PickerDialog";

/**
 * Green Screen Meme's "Upload image or video": what the meme sits on, chosen
 * in a popup -- a photo or clip from the client's gallery, or a new upload --
 * like the demo video popup, but taking a still as readily as a video.
 *
 * Stores the bare asset id, exactly as an upload control would.
 */
type Tab = "gallery" | "upload";
type Filter = "all" | "image" | "video";

const ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm";
const allowed = (mime: string) => /^image\/(png|jpeg|webp)$/.test(mime) || mime.startsWith("video/");

export function BackgroundField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (assetId: string | null) => void;
}) {
  const id = typeof value === "string" && value ? value : null;
  const info = useQuery(api.assets.mediaInfo, id ? { assetId: id as Id<"assets"> } : "skip");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5 text-left transition hover:border-accent"
      >
        {info?.url ? (
          <Thumb url={info.url} isVideo={info.isVideo} poster={info.posterUrl} className="w-10" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <FrameIcon />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {id ? (info?.isVideo ? "Your video" : "Your photo") : "Choose what the meme sits on"}
          </span>
          <span className="block truncate text-xs text-muted">
            {id
              ? info?.isVideo
                ? ["Video background", info.durationSec ? clock(info.durationSec) : null].filter(Boolean).join(" · ")
                : "Photo background"
              : "A photo or video from your gallery, or upload one"}
          </span>
        </span>
        <span className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs group-hover:border-accent">
          {id ? "Change" : "Choose"}
        </span>
      </button>
      {open && (
        <BackgroundDialog
          value={id}
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

function BackgroundDialog({
  value,
  onClose,
  onPick,
}: {
  value: string | null;
  onClose: () => void;
  onPick: (assetId: string) => void;
}) {
  const images = useQuery(api.assets.mediaLibrary, { kind: "image" });
  const videos = useQuery(api.assets.mediaLibrary, { kind: "video" });
  const [tab, setTab] = useState<Tab>("gallery");
  const [filter, setFilter] = useState<Filter>("all");
  const [chosen, setChosen] = useState<string | null>(value);
  // A new upload is what the user came for: it's applied straight away.
  const upload = useMediaUpload(onPick, {
    as: "media",
    accept: ACCEPT,
    allowed,
    rejected: "isn't a photo (PNG, JPG, WebP) or a video.",
  });

  // Newest first across both kinds -- the gallery is one place, not two.
  const all = useMemo(() => {
    if (images === undefined || videos === undefined) return undefined;
    const rows = [
      ...images.map((i) => ({ ...i, isVideo: false })),
      ...videos.map((v) => ({ ...v, isVideo: true })),
    ];
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [images, videos]);
  const shown = all?.filter((r) => filter === "all" || (filter === "video") === r.isVideo);
  const picked = chosen ? all?.find((r) => r.id === chosen) : undefined;

  return (
    <PickerDialog
      title="Upload image or video"
      blurb="What your meme sits on: a photo of you, your shop or your product — or a video, and the meme plays over it."
      onClose={onClose}
      tabs={
        <>
          <TabButton on={tab === "gallery"} onClick={() => setTab("gallery")}>
            From your gallery
          </TabButton>
          <TabButton on={tab === "upload"} onClick={() => setTab("upload")}>
            Upload new
          </TabButton>
        </>
      }
      footer={
        tab === "gallery" ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {picked ? (picked.isVideo ? "Your video" : "Your photo") : "Nothing picked yet"}
              </p>
              <p className="truncate text-xs text-muted">
                {picked
                  ? picked.isVideo
                    ? `The video sets the length${picked.durationSec ? ` · ${clock(picked.durationSec)}` : ""}`
                    : "The meme loops over it · you set the length in the editor"
                  : "Tap to pick; double-click to use it straight away."}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => chosen && onPick(chosen)}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_var(--accent)] hover:opacity-90 disabled:opacity-40"
            >
              Use this background
            </button>
          </div>
        ) : undefined
      }
    >
      {upload.error && <p className="mb-3 text-sm text-accent">{upload.error}</p>}
      {tab === "gallery" ? (
        <>
          <div className="mb-4 inline-flex rounded-full border border-line bg-surface-sub p-0.5 text-xs">
            {(
              [
                ["all", "All"],
                ["image", "Photos"],
                ["video", "Videos"],
              ] as const
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={[
                  "rounded-full px-3 py-1 transition",
                  filter === f ? "bg-surface font-semibold text-accent shadow-sm" : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          {shown === undefined ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-surface-sub" />
              ))}
            </div>
          ) : shown.length ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {shown.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setChosen(r.id)}
                  onDoubleClick={() => onPick(r.id)}
                  aria-pressed={chosen === r.id}
                  className={[
                    "group relative overflow-hidden rounded-2xl bg-black text-left transition",
                    chosen === r.id ? "ring-[3px] ring-accent" : "ring-1 ring-line hover:ring-accent",
                  ].join(" ")}
                >
                  {r.url && <Thumb url={r.url} isVideo={r.isVideo} poster={r.posterUrl} className="w-full" hoverPlay />}
                  <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[0.6rem] font-medium text-white">
                    {r.isVideo ? "Video" : "Photo"}
                  </span>
                  {r.isVideo && r.durationSec ? (
                    <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 font-mono text-[0.6rem] text-white">
                      {clock(r.durationSec)}
                    </span>
                  ) : null}
                  {chosen === r.id && <PickedTick />}
                </button>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted">
              Nothing here yet.{" "}
              <button type="button" onClick={() => setTab("upload")} className="font-semibold text-accent underline">
                Upload a photo or video
              </button>
            </p>
          )}
        </>
      ) : (
        <DropZone
          busy={upload.busy}
          onPick={upload.pick}
          onFile={upload.uploadFile}
          title="Drop a photo or video here, or click to choose one"
          hint="PNG, JPG or WebP photos · MP4, MOV or WebM videos. It's kept in your gallery for next time."
        />
      )}
      {upload.input}
    </PickerDialog>
  );
}

/** A 9:16 tile of a photo or a video's first frame; a video plays while hovered. */
export function Thumb({
  url,
  isVideo,
  poster,
  className,
  hoverPlay,
}: {
  url: string;
  isVideo: boolean;
  poster?: string | null;
  className?: string;
  hoverPlay?: boolean;
}) {
  const cls = `aspect-[9/16] shrink-0 rounded-lg bg-black object-cover ${className ?? ""}`;
  return isVideo ? (
    <video
      src={`${url}#t=0.1`}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      className={cls}
      onMouseEnter={hoverPlay ? (e) => void e.currentTarget.play().catch(() => {}) : undefined}
      onMouseLeave={
        hoverPlay
          ? (e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0.1;
            }
          : undefined
      }
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={cls} />
  );
}

function FrameIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m3.5 15.5 4.2-4.2a2 2 0 0 1 2.8 0l5 5" />
      <path d="m14 14 1.8-1.8a2 2 0 0 1 2.8 0L21 14.5" />
      <circle cx="15.5" cy="8.5" r="1.4" />
    </svg>
  );
}
