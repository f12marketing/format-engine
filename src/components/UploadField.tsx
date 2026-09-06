"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Upload a file straight to Convex storage.
 *
 * Three hops rather than one mutation: ask for a short-lived signed URL, PUT
 * the bytes at it, then record the asset. The bytes never pass through a
 * function argument, which is what keeps a 200MB demo video from being a
 * problem -- and twelve of the sixteen formats take an upload, so this path is
 * worth having exactly once.
 */
export function UploadField({
  accept,
  value,
  onChange,
}: {
  accept: "image" | "video";
  value: unknown;
  onChange: (assetId: string | null) => void;
}) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acceptAttr =
    accept === "video" ? "video/*,image/*" : "image/png,image/jpeg,image/webp";

  async function upload(file: File) {
    setState("uploading");
    setError(null);
    setName(file.name);
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
      setState("idle");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
      onChange(null);
    }
  }

  const has = Boolean(value);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={state === "uploading"}
        className={[
          "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm",
          has ? "border-accent bg-accent-soft" : "border-dashed border-line bg-surface-sub",
          state === "uploading" ? "opacity-60" : "hover:border-accent",
        ].join(" ")}
      >
        <span aria-hidden>{accept === "video" ? "🎞️" : "🖼️"}</span>
        <span className="min-w-0 flex-1 truncate">
          {state === "uploading"
            ? `Uploading ${name}…`
            : has
              ? (name ?? "Uploaded")
              : `Choose ${accept === "video" ? "a video or image" : "an image"}`}
        </span>
        {has && state === "idle" && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              setName(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange(null);
                setName(null);
              }
            }}
            className="shrink-0 rounded px-1 text-muted hover:text-foreground"
          >
            ×
          </span>
        )}
      </button>
      {error && <p className="mt-1 text-xs text-accent">{error}</p>}
    </div>
  );
}
