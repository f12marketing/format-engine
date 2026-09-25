"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export interface UploadedImage {
  assetId: string;
  /** A local object URL, so the picture shows at once without waiting on storage. */
  url: string;
}

/** Uploads one image the way every picker in the app does: signed URL, then an `assets` row. */
export function useUpload() {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  return async (file: File): Promise<UploadedImage> => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      throw new Error("Use PNG, JPEG or WebP images.");
    }
    const local = URL.createObjectURL(file);
    const size = await new Promise<{ width?: number; height?: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = local;
    });
    const url = await generateUploadUrl();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const { storageId } = (await res.json()) as { storageId: string };
    const assetId = await attach({ storageId: storageId as never, mimeType: file.type, bytes: file.size, ...size });
    return { assetId, url: local };
  };
}
