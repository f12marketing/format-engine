"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Choose an overlay image: one already in your library, or a new upload.
 * Returns the asset id and a URL to preview it with straight away.
 */
export function ImagePickerDialog({
  onPick,
  onClose,
}: {
  onPick: (assetId: string, url: string) => void;
  onClose: () => void;
}) {
  const images = useQuery(api.assets.mediaLibrary, { kind: "image" });
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Use a PNG, JPEG or WebP image. A PNG with a transparent background works best.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const local = URL.createObjectURL(file);
      const size = await new Promise<{ width?: number; height?: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({});
        img.src = local;
      });
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
        ...size,
      });
      onPick(assetId, local);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Choose an overlay image"
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-4 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold">Overlay image</h2>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Uploading…" : "+ Upload new"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-sub hover:text-foreground"
          >
            ×
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
        <p className="mt-1 text-xs text-muted">
          A logo, a sticker, a screenshot of your app. Transparent PNGs sit best on video.
        </p>
        {error && <p className="mt-2 text-xs text-accent">{error}</p>}

        <div className="mt-3 max-h-[50vh] overflow-y-auto">
          {images === undefined ? (
            <p className="py-8 text-center text-xs text-muted">Loading your images…</p>
          ) : images.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">No images in your library yet — upload one.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((img) =>
                img.url ? (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => onPick(img.id, img.url!)}
                    className="group aspect-square overflow-hidden rounded-lg border border-line bg-[conic-gradient(#e7e1e5_25%,#fff_0_50%,#e7e1e5_0_75%,#fff_0)] bg-[length:16px_16px] hover:border-accent"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="size-full object-contain transition group-hover:scale-105" />
                  </button>
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
