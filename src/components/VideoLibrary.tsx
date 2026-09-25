"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * The casting popup's Videos tab: a clip from the trending library, one of
 * your own videos, or a new upload.
 *
 * Values are tagged -- "clip:<id>" for the shared library, "video:<assetId>"
 * for your own -- because the same field also holds people (see
 * convex/lib/roster.ts), and a bare id there already means an avatar.
 * convex/lib/videoRef.ts resolves both.
 */
type Tab = "trending" | "mine";

export function isVideoRef(ref: string | null | undefined): boolean {
  return Boolean(ref && /^(clip|video):/.test(ref));
}

export function VideoLibrary({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (ref: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(value?.startsWith("video:") ? "mine" : "trending");
  const upload = useVideoUpload((assetId) => onPick(`video:${assetId}`));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["trending", "Trending library"],
            ["mine", "Your videos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              "rounded-full border px-3.5 py-1.5 text-xs transition",
              tab === id ? "border-accent bg-accent text-white" : "border-line hover:border-accent",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={upload.pick}
          disabled={upload.busy}
          className="ml-auto rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {upload.busy ? "Uploading…" : "+ Upload a video"}
        </button>
        {upload.input}
      </div>
      <p className="text-sm text-muted">
        Already have the clip? Use it as-is — we&apos;ll only add the text. A casual, unedited phone video works best.
      </p>
      {upload.error && <p className="text-sm text-accent">{upload.error}</p>}
      {tab === "trending" ? (
        <TrendingGrid value={value} onPick={onPick} />
      ) : (
        <MineGrid value={value} onPick={onPick} onUpload={upload.pick} />
      )}
    </div>
  );
}

function TrendingGrid({ value, onPick }: { value: string | null; onPick: (ref: string) => void }) {
  const clips = useQuery(api.clips.list, { limit: 50 });
  if (clips === undefined) return <Note>Loading the trending library…</Note>;
  if (!clips.length) {
    return <Note>No trending clips yet. Upload your own, or ask whoever runs the deployment to ingest some.</Note>;
  }
  return (
    <Grid>
      {clips.map((c) => (
        <Tile
          key={c.id}
          url={c.url}
          selected={value === `clip:${c.id}`}
          caption={c.creatorHandle ? `@${c.creatorHandle}` : c.source}
          seconds={c.durationSec}
          onPick={() => onPick(`clip:${c.id}`)}
        />
      ))}
    </Grid>
  );
}

function MineGrid({
  value,
  onPick,
  onUpload,
}: {
  value: string | null;
  onPick: (ref: string) => void;
  onUpload: () => void;
}) {
  const videos = useQuery(api.assets.mediaLibrary, { kind: "video" });
  if (videos === undefined) return <Note>Loading your videos…</Note>;
  if (!videos.length) {
    return (
      <Note>
        Nothing here yet.{" "}
        <button type="button" onClick={onUpload} className="font-semibold text-accent underline">
          Upload a video
        </button>
      </Note>
    );
  }
  return (
    <Grid>
      {videos.map((a) => (
        <Tile
          key={a.id}
          url={a.url}
          poster={a.posterUrl}
          selected={value === `video:${a.id}`}
          caption={a.uploaded ? "Upload" : "Generated"}
          seconds={a.durationSec}
          onPick={() => onPick(`video:${a.id}`)}
        />
      ))}
    </Grid>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-4 text-center text-xs text-muted">{children}</p>;
}

function Tile({
  url,
  poster,
  selected,
  caption,
  seconds,
  onPick,
}: {
  url: string | null;
  poster?: string | null;
  selected: boolean;
  caption: string;
  seconds?: number;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`relative overflow-hidden rounded-2xl border bg-surface-sub text-left transition ${
        selected ? "border-accent ring-[3px] ring-accent" : "border-line hover:-translate-y-0.5 hover:shadow-lg"
      }`}
    >
      {url ? (
        <video
          src={url}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full bg-black object-cover"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
      ) : (
        <div className="aspect-[9/16] w-full bg-line-strong" />
      )}
      {seconds ? (
        <span className="absolute right-1 top-1 rounded bg-black/60 px-1 font-mono text-[0.55rem] text-white">
          {Math.round(seconds)}s
        </span>
      ) : null}
      <p className="truncate px-1.5 py-1 font-mono text-[0.6rem] text-muted">{caption}</p>
    </button>
  );
}

/**
 * Upload a video and record it as an asset, with its real size and length
 * read in the browser first -- the publish pre-flight and the library tiles
 * both use them, and the browser already has the file.
 */
export function useVideoUpload(
  onDone: (assetId: string) => void,
  /** Record it as a hook, so it lands in the hook popup's My hooks. */
  { asHook = false }: { asHook?: boolean } = {},
) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attachVideo = useMutation(api.uploads.attach);
  const attachHook = useMutation(api.hooks.attachUpload);
  const attach = asHook ? attachHook : attachVideo;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    // `accept` filters the dialog, not the file: "All files" gets round it.
    if (!file.type.startsWith("video/")) {
      setError(`${file.name} isn't a video.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = await readVideoMeta(file);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const assetId = await attach({
        storageId: storageId as never,
        mimeType: file.type,
        bytes: file.size,
        ...meta,
      });
      onDone(assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    pick: () => inputRef.current?.click(),
    /** For a drop zone: the same checks and recording as a picked file. */
    uploadFile: (file: File) => void upload(file),
    input: (
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    ),
  };
}

function readVideoMeta(
  file: File,
): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (meta: { width?: number; height?: number; durationSec?: number }) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      done({
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
        durationSec: Number.isFinite(v.duration) ? v.duration : undefined,
      });
    // A codec the browser can't read still uploads; it just arrives without facts.
    v.onerror = () => done({});
    v.src = url;
  });
}
