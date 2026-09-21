"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Several images as one ordered value.
 *
 * Same three hops as UploadField -- signed URL, PUT the bytes, record the
 * asset -- run once per file, so a cast of four reference sheets never passes
 * through a function argument.
 *
 * Order is shown and editable because it is load-bearing: the composite step
 * names each reference by index in its prompt, so "Character 1" is whichever
 * tile sits first here. A grid that silently reordered on re-render would
 * rename everybody's cast mid-run.
 */
export function MultiUploadField({
  value,
  onChange,
  maxItems = 4,
}: {
  value: unknown;
  onChange: (assetIds: string[]) => void;
  maxItems?: number;
}) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ids = Array.isArray(value) ? (value as string[]) : [];
  const remaining = Math.max(0, maxItems - ids.length);

  // Thumbnails come from the assets themselves rather than from an object URL
  // held in state: a re-render must not drop the preview of something already
  // uploaded, and the signed URL is what the render step will use anyway.
  const urls = useQuery(
    api.assets.urlsFor,
    ids.length ? { assetIds: ids as Id<"assets">[] } : "skip",
  );

  async function uploadFiles(files: FileList) {
    const chosen = Array.from(files).slice(0, remaining);
    if (!chosen.length) return;

    setError(null);
    setUploading(chosen.length);
    const added: string[] = [];
    try {
      // Sequential, not Promise.all: the order files land in IS the cast
      // order, and parallel uploads finish in whatever order the network
      // decides.
      for (const file of chosen) {
        if (!file.type.startsWith("image/")) {
          throw new Error(`${file.name} isn't an image.`);
        }
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        added.push(
          await attach({
            storageId: storageId as never,
            mimeType: file.type,
            bytes: file.size,
          }),
        );
      }
      onChange([...ids, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Whatever did land is kept -- losing three good uploads because the
      // fourth failed would be the worse outcome.
      if (added.length) onChange([...ids, ...added]);
    } finally {
      setUploading(0);
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div>
      {ids.length > 0 && (
        <ul className="mb-2 grid grid-cols-4 gap-2">
          {ids.map((id, i) => {
            const url = urls?.find((u) => u && u.id === id)?.url;
            return (
              <li
                key={id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface-sub"
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="size-full object-cover" />
                ) : (
                  <div className="size-full animate-pulse bg-surface-sub" />
                )}

                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[0.65rem] font-semibold text-white">
                  {i + 1}
                </span>

                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    aria-label="Move earlier"
                    className="px-1.5 text-xs text-white disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(ids.filter((x) => x !== id))}
                    aria-label="Remove"
                    className="px-1.5 text-xs text-white"
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, i + 1)}
                    disabled={i === ids.length - 1}
                    aria-label="Move later"
                    className="px-1.5 text-xs text-white disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading > 0 || remaining === 0}
        className={[
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm",
          "border-dashed border-line bg-surface-sub",
          uploading > 0 || remaining === 0 ? "opacity-60" : "hover:border-accent",
        ].join(" ")}
      >
        <span aria-hidden>🖼️</span>
        <span className="min-w-0 flex-1 truncate">
          {uploading > 0
            ? `Uploading ${uploading}…`
            : remaining === 0
              ? `${ids.length} of ${maxItems} — remove one to add another`
              : `Add ${ids.length ? "another" : "an"} image · ${remaining} left`}
        </span>
      </button>
      {error && <p className="mt-1 text-xs text-accent">{error}</p>}
    </div>
  );
}
