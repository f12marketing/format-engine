"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Pick an audio clip, or upload one.
 *
 * Both halves of the spec's "select audio clip templates or upload a new
 * audio clip": the house library up top, the client's own uploads below, and
 * an upload button that adds to the latter. A template's value is tagged
 * ("template:<id>") so the two tables stay distinguishable downstream -- see
 * convex/lib/audioRef.ts, which mirrors the avatar/influencer convention.
 *
 * "Silent" is a deliberate option rather than an empty selection, because on
 * these formats no audio is a real choice and an empty field reads as unset.
 */
export function AudioClipField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (audioRef: string | null) => void;
}) {
  const templates = useQuery(api.audio.listTemplates);
  const clips = useQuery(api.assets.audioLibrary);
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
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
      });
      onChange(assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  if (clips === undefined || templates === undefined) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
        Loading audio…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={[
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
          value === null || value === undefined
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface-sub hover:border-accent",
        ].join(" ")}
      >
        <span aria-hidden>🔇</span>
        <span className="flex-1">Silent</span>
      </button>

      {templates.length > 0 && (
        <>
          <p className="pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
            House library
          </p>
          {templates.map((template) => (
            <ClipRow
              key={template.id}
              label={template.name}
              meta={template.durationSec ? `${Math.round(template.durationSec)}s` : undefined}
              url={template.url}
              selected={value === `template:${template.id}`}
              onSelect={() => onChange(`template:${template.id}`)}
            />
          ))}
        </>
      )}

      {clips.length > 0 && (
        <p className="pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
          Your uploads
        </p>
      )}
      {clips.map((clip) => (
        <ClipRow
          key={clip.id}
          label={
            clip.durationSec
              ? `${Math.round(clip.durationSec)}s clip`
              : `${(clip.bytes / 1024 / 1024).toFixed(1)} MB clip`
          }
          meta={new Date(clip.createdAt).toLocaleDateString()}
          url={clip.url}
          selected={value === clip.id}
          onSelect={() => onChange(clip.id)}
        />
      ))}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full rounded-lg border border-dashed border-line py-2 text-xs text-muted hover:border-accent hover:text-foreground disabled:opacity-60"
      >
        {uploading ? "Uploading…" : "+ Upload an audio clip"}
      </button>
      {error && <p className="text-xs text-accent">{error}</p>}
    </div>
  );
}

function ClipRow({
  label,
  meta,
  url,
  selected,
  onSelect,
}: {
  label: string;
  meta?: string;
  url: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={[
        "rounded-lg border px-3 py-2",
        selected ? "border-accent bg-accent-soft" : "border-line bg-surface-sub",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <span aria-hidden>🎵</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta && (
          <span className="shrink-0 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            {meta}
          </span>
        )}
      </button>
      {/* preload="none" so a picker with twenty clips doesn't fetch twenty files. */}
      {url && <audio src={url} controls preload="none" className="mt-2 h-8 w-full" />}
    </div>
  );
}
