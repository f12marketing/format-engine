"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  GENERATED_IMAGES_PER_DAY,
  OVERLAY_PRESETS,
  presetStyle,
  type OverlayPreset,
} from "../../../convex/lib/imageSlideshowDesign";
import { cleanError } from "../wall/WallStudio";
import { useUpload } from "./useUpload";
import { SetBrowser } from "./ImageSetPicker";

type Tab = "sets" | "deck" | "library" | "generate";

export interface PickedImage {
  assetId: string;
  url: string;
  /** Set when the image was generated here -- becomes the slide's imagePrompt. */
  prompt?: string;
}

function Shell({
  title,
  blurb,
  onClose,
  actions,
  children,
}: {
  title: string;
  blurb: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-xs text-muted">{blurb}</p>
          </div>
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-sub hover:text-foreground"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function UploadButton({ onPicked, onError }: { onPicked: (p: PickedImage) => void; onError: (m: string) => void }) {
  const upload = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Uploading…" : "+ Upload"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onPicked(await upload(file));
          } catch (err) {
            onError(cleanError(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function Grid({
  items,
  onPick,
  checker,
}: {
  items: { id: string; url: string | null }[];
  onPick: (p: PickedImage) => void;
  checker?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((img) =>
        img.url ? (
          <button
            key={img.id}
            type="button"
            onClick={() => onPick({ assetId: img.id, url: img.url! })}
            className={[
              "group aspect-[3/4] overflow-hidden rounded-lg border border-line hover:border-accent",
              checker
                ? "bg-[conic-gradient(#e7e1e5_25%,#fff_0_50%,#e7e1e5_0_75%,#fff_0)] bg-[length:16px_16px]"
                : "bg-surface-sub",
            ].join(" ")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt=""
              className={`size-full transition group-hover:scale-105 ${checker ? "object-contain" : "object-cover"}`}
            />
          </button>
        ) : null,
      )}
    </div>
  );
}

function LibraryGrid({ onPick, checker }: { onPick: (p: PickedImage) => void; checker?: boolean }) {
  const images = useQuery(api.assets.mediaLibrary, { kind: "image" });
  if (images === undefined) return <p className="py-10 text-center text-xs text-muted">Loading your images…</p>;
  if (!images.length) return <p className="py-10 text-center text-xs text-muted">No images yet — upload one.</p>;
  return <Grid items={images.map((i) => ({ id: i.id, url: i.url }))} onPick={onPick} checker={checker} />;
}

/**
 * Where a slide's image comes from: a photo from any image set, one already in
 * this slideshow, anything in the library, an upload -- or, when nothing fits,
 * one generated from a description.
 */
export function ImageSourceDialog({
  jobId,
  title,
  blurb,
  ratio,
  initialPrompt = "",
  defaultSet = null,
  deckImages,
  allowGenerate = true,
  checker = false,
  onPick,
  onClose,
}: {
  jobId: Id<"jobs">;
  title: string;
  blurb: string;
  ratio: string;
  initialPrompt?: string;
  /** The image set this slideshow was made from -- the Image sets tab opens on it. */
  defaultSet?: string | null;
  /** The images already in this deck, for reuse. */
  deckImages: { id: string; url: string }[];
  allowGenerate?: boolean;
  /** Transparent-friendly thumbnails, for pictures and stickers. */
  checker?: boolean;
  onPick: (p: PickedImage) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(defaultSet ? "sets" : deckImages.length ? "deck" : "library");
  const adoptSetImage = useMutation(api.imageSets.use);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const generate = useAction(api.imageSlideshow.generateImage);

  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      const out = await generate({ jobId, prompt, ratio });
      onPick({ ...out, prompt });
    } catch (e) {
      setError(cleanError(e));
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "sets", label: "Image sets" },
    ...(deckImages.length ? [{ id: "deck" as const, label: "This slideshow" }] : []),
    { id: "library", label: "My images" },
    ...(allowGenerate ? [{ id: "generate" as const, label: "Generate" }] : []),
  ];

  return (
    <Shell
      title={title}
      blurb={blurb}
      onClose={onClose}
      actions={<UploadButton onPicked={onPick} onError={setError} />}
    >
      <div className="flex gap-1 border-b border-line px-4 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium",
              tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="mx-4 mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{error}</p>}
      {tab === "sets" && (
        <div className={`flex min-h-0 flex-1 flex-col ${adopting ? "pointer-events-none opacity-60" : ""}`}>
          <SetBrowser
            selectedSet={defaultSet}
            initialOpen={defaultSet}
            onPickPhoto={(p) => onPick(p)}
            onPickImage={async (img) => {
              setAdopting(true);
              setError(null);
              try {
                const out = await adoptSetImage({ imageId: img.id as Id<"stockImages"> });
                onPick({ assetId: out.assetId, url: out.url ?? img.url ?? "" });
              } catch (e) {
                setError(cleanError(e));
                setAdopting(false);
              }
            }}
          />
        </div>
      )}
      <div className={`overflow-y-auto p-4 ${tab === "sets" ? "hidden" : ""}`}>
        {tab === "generate" && (
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              maxLength={800}
              placeholder="What should the photo show? e.g. a latte on a windowsill, morning light"
              className="w-full resize-y rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                Drawn at {ratio} and saved to My images. Up to {GENERATED_IMAGES_PER_DAY} a day.
              </p>
              <button
                type="button"
                onClick={onGenerate}
                disabled={busy || !prompt.trim()}
                className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Generating… (~20s)" : "Generate · $0.08"}
              </button>
            </div>
          </div>
        )}
        {tab === "deck" && <Grid items={deckImages} onPick={onPick} checker={checker} />}
        {tab === "library" && <LibraryGrid onPick={onPick} checker={checker} />}
      </div>
    </Shell>
  );
}

export type PickedOverlay = { preset: OverlayPreset } | { assetId: string; url: string };

/**
 * Add Overlay: a built-in tint or texture, previewed on this slide's own
 * photo, or an image of the client's laid over the whole slide.
 */
export function OverlayDialog({
  photoUrl,
  onPick,
  onClose,
}: {
  photoUrl: string | null;
  onPick: (o: PickedOverlay) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell
      title="Add overlay"
      blurb="A tint or texture over the whole slide, under the text. Or lay one of your own images over it."
      onClose={onClose}
      actions={<UploadButton onPicked={(p) => onPick(p)} onError={setError} />}
    >
      {error && <p className="mx-4 mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{error}</p>}
      <div className="space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">Gallery</h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {OVERLAY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick({ preset: p.id })}
                className="group flex flex-col items-center gap-1"
              >
                <span
                  className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-[linear-gradient(160deg,#c9a98d,#6f5a4c_55%,#2d2622)] bg-cover bg-center ring-1 ring-line transition group-hover:ring-2 group-hover:ring-accent"
                  style={photoUrl ? { backgroundImage: `url("${photoUrl}")` } : undefined}
                >
                  <span className="absolute inset-0" style={{ ...(presetStyle(p.id) as React.CSSProperties), opacity: 0.8 }} />
                </span>
                <span className="text-[0.62rem] text-muted">{p.label}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">My images</h3>
          <LibraryGrid onPick={(p) => onPick(p)} checker />
        </section>
      </div>
    </Shell>
  );
}
