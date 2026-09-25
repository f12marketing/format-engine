"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * An image-or-video upload for the Green Screen Meme popups: the background
 * ("media") or a meme of the client's own ("meme", marked so My memes offers
 * it again). Same three hops as every upload -- a signed URL, the bytes, then
 * the asset row -- with the file's shape read first, since the editor places
 * a meme by it.
 */
export function useMediaUpload(
  onDone: (assetId: string) => void,
  { as, accept, allowed, rejected }: { as: "media" | "meme"; accept: string; allowed: (mime: string) => boolean; rejected: string },
) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attachMedia = useMutation(api.uploads.attach);
  const attachMeme = useMutation(api.uploads.attachMeme);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    // `accept` filters the dialog, not the file: "All files" gets round it.
    if (!allowed(file.type)) {
      setError(`${file.name}: ${rejected}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = await readMediaMeta(file);
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const attach = as === "meme" ? attachMeme : attachMedia;
      const assetId = await attach({ storageId: storageId as never, mimeType: file.type, bytes: file.size, ...meta });
      onDone(assetId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/Uncaught Error: ([^\n]+)/.exec(msg)?.[1] ?? msg);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    pick: () => inputRef.current?.click(),
    uploadFile: (file: File) => void upload(file),
    input: (
      <input
        ref={inputRef}
        type="file"
        accept={accept}
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

/** Width, height and -- for a video -- length, read in the browser. A file it can't read still uploads, without them. */
export function readMediaMeta(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (meta: { width?: number; height?: number; durationSec?: number }) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        done({
          width: v.videoWidth || undefined,
          height: v.videoHeight || undefined,
          durationSec: Number.isFinite(v.duration) ? v.duration : undefined,
        });
      v.onerror = () => done({});
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
      img.onerror = () => done({});
      img.src = url;
    }
  });
}
