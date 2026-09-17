"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * The Influencer creation popup -- three steps: persona, training photos,
 * train. Modelled after FormatPicker's modal chrome (this app's only other
 * popup) rather than the reference screenshots' sidebar-SaaS look, since
 * that look belongs to a different, more built-out product than this one.
 * The reference's "credits" balance/purchase flow is deliberately dropped --
 * billing here stays on the existing USD spend_ledger throughout.
 */
export function NewInfluencerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: Id<"influencers">) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [personaNotes, setPersonaNotes] = useState("");
  const [trainingAssetIds, setTrainingAssetIds] = useState<Id<"assets">[]>([]);
  const [influencerId, setInfluencerId] = useState<Id<"influencers"> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const STEP_LABELS = ["Base image", "Training photos", "Train"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-influencer-title"
        className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="new-influencer-title" className="text-lg font-semibold">
              New influencer
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Step {step} of 3 · {STEP_LABELS[step - 1]}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-surface-sub hover:text-foreground"
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${s <= step ? "bg-accent" : "bg-line"}`}
            />
          ))}
        </div>

        <div className="mt-5">
          {step === 1 && (
            <BaseImageStep
              onNext={(newName, notes, baseImageAssetId) => {
                setName(newName);
                setPersonaNotes(notes);
                setTrainingAssetIds([baseImageAssetId]);
                setStep(2);
              }}
              onCancel={onClose}
            />
          )}
          {step === 2 && (
            <TrainingPhotosStep
              personaNotes={personaNotes}
              trainingAssetIds={trainingAssetIds}
              onChangeAssetIds={setTrainingAssetIds}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <TrainStep
              name={name}
              personaNotes={personaNotes}
              trainingAssetIds={trainingAssetIds}
              influencerId={influencerId}
              onCreated={setInfluencerId}
              onBack={() => setStep(2)}
              onDone={(id) => {
                onCreated(id);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type BaseImageTab = "generate" | "upload" | "gallery";
type BaseImage = { id: Id<"assets">; url: string };

/**
 * Step 1: name/gender/age/ethnicity feed the same `personaNotes` string the
 * rest of the flow already ran on (generation prompts, the influencer's
 * persona field) -- composed here rather than typed as one free-text block,
 * but nothing downstream needs to know that changed. Exactly one base image
 * comes out of this step regardless of which tab produced it, and it becomes
 * the first training photo Step 2 already knows how to display and count.
 */
function BaseImageStep({
  onNext,
  onCancel,
}: {
  onNext: (name: string, personaNotes: string, baseImageAssetId: Id<"assets">) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<BaseImageTab>("generate");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState(25);
  const [ethnicity, setEthnicity] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [baseImage, setBaseImage] = useState<BaseImage | null>(null);
  const [picker, setPicker] = useState<"media-bank" | "gallery" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = useQuery(api.influencers.config);
  const generateFace = useAction(api.influencers.generateFaceImage);
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);

  function switchTab(next: BaseImageTab) {
    // A face picked on one tab has no business surviving a switch to another.
    setTab(next);
    setBaseImage(null);
    setError(null);
  }

  function composePersonaNotes(): string {
    const descriptors = [ethnicity.trim(), gender.toLowerCase()].filter(Boolean);
    const who = descriptors.length
      ? `a ${age}-year-old ${descriptors.join(" ")} person`
      : `a ${age}-year-old person`;
    return [`${who}.`, additionalDetails.trim()].filter(Boolean).join(" ");
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const assetId = await attach({ storageId: storageId as never, mimeType: file.type, bytes: file.size });
      setBaseImage({ id: assetId, url: URL.createObjectURL(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canContinue = name.trim().length > 0 && !busy && (tab === "generate" || Boolean(baseImage));

  async function handleNext() {
    if (!canContinue) return;
    setError(null);
    const personaNotes = composePersonaNotes();
    if (tab !== "generate") {
      if (baseImage) onNext(name.trim(), personaNotes, baseImage.id);
      return;
    }
    setBusy(true);
    try {
      const assetId = await generateFace({ personaNotes });
      onNext(name.trim(), personaNotes, assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-surface-sub p-1">
        {(
          [
            ["generate", "Generate base image"],
            ["upload", "Upload your own"],
            ["gallery", "Pick from gallery"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchTab(value)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              tab === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        {tab === "generate"
          ? `Describe your character. We'll generate a base image as soon as you continue${
              config ? ` (~$${config.faceImageCostUsd.toFixed(2)})` : ""
            }.`
          : "Describe your character and choose a base image. We'll use it as-is, no generation."}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mia"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Gender
          </label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">Select…</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Non-binary">Non-binary</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 flex items-baseline justify-between font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            <span>Age</span>
            <span className="text-foreground">{age}</span>
          </label>
          <input
            type="range"
            min={18}
            max={60}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Ethnicity
          </label>
          <input
            value={ethnicity}
            onChange={(e) => setEthnicity(e.target.value)}
            placeholder="e.g. East Asian"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      {tab === "generate" && (
        <div>
          <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Additional details (optional)
          </label>
          <textarea
            value={additionalDetails}
            onChange={(e) => setAdditionalDetails(e.target.value)}
            rows={3}
            placeholder="e.g. freckles, athletic build, curly red hair"
            className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
      )}

      {tab === "upload" && (
        <div className="rounded-lg border border-dashed border-line bg-surface-sub p-4 text-center">
          {baseImage ? (
            <div className="flex items-center justify-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={baseImage.url} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
              <button
                type="button"
                onClick={() => setBaseImage(null)}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Choose a different photo
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                Choose a portrait. Clear, single-person, well-lit works best.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) void handleFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
                >
                  {busy ? "Uploading…" : "Upload image"}
                </button>
                <button
                  type="button"
                  onClick={() => setPicker("media-bank")}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs hover:border-accent"
                >
                  Pick from media bank
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "gallery" && (
        <div className="rounded-lg border border-dashed border-line bg-surface-sub p-4 text-center">
          {baseImage ? (
            <div className="flex items-center justify-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={baseImage.url} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
              <button
                type="button"
                onClick={() => setBaseImage(null)}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Choose a different face
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">
                Browse our curated gallery and pick a ready-made base face.
              </p>
              <button
                type="button"
                onClick={() => setPicker("gallery")}
                className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs hover:border-accent"
              >
                Browse gallery
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-accent">{error}</p>}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canContinue}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy && tab === "generate" ? "Generating…" : "Next"}
        </button>
      </div>

      {picker === "media-bank" && (
        <MediaBankPickerModal
          onPick={(asset) => {
            setBaseImage(asset);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "gallery" && (
        <GalleryPickerModal
          onPick={(asset) => {
            setBaseImage(asset);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Picks one of the client's own uploaded images -- "Upload your own"'s second option. */
function MediaBankPickerModal({
  onPick,
  onClose,
}: {
  onPick: (asset: BaseImage) => void;
  onClose: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.assets.library,
    { source: "uploaded" },
    { initialNumItems: 24 },
  );
  const images = results.filter((a) => a.kind === "image" && a.url);
  const [selected, setSelected] = useState<BaseImage | null>(null);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Pick from media bank</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Close
          </button>
        </div>

        {status === "LoadingFirstPage" ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : images.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-surface-sub p-4 text-center text-sm text-muted">
            No uploaded images yet.
          </p>
        ) : (
          <div className="mt-4 grid max-h-96 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
            {images.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected({ id: a.id, url: a.url! })}
                className={`aspect-square overflow-hidden rounded-md border-2 ${
                  selected?.id === a.id ? "border-accent" : "border-transparent hover:border-line-strong"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url!} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {status === "CanLoadMore" && (
          <button
            type="button"
            onClick={() => loadMore(24)}
            className="mt-3 w-full rounded-lg border border-line bg-surface-sub py-2 text-xs text-muted hover:border-accent"
          >
            Load more
          </button>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => selected && onPick(selected)}
            disabled={!selected}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Use this photo
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The curated influencer gallery -- ready-made base faces, shared across
 * every client (galleryFaces.ts). Picking one copies it into the client's
 * own assets server-side (galleryFaces.useFace), so what comes back is a
 * normal owned asset id, same as generating or uploading one.
 */
function GalleryPickerModal({
  onPick,
  onClose,
}: {
  onPick: (asset: BaseImage) => void;
  onClose: () => void;
}) {
  const faces = useQuery(api.galleryFaces.list);
  const pickFace = useMutation(api.galleryFaces.useFace);
  const [selected, setSelected] = useState<{ id: Id<"galleryFaces">; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const assetId = await pickFace({ faceId: selected.id });
      onPick({ id: assetId, url: selected.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Pick from gallery</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Close
          </button>
        </div>

        {faces === undefined ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : faces.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-surface-sub p-4 text-center text-sm text-muted">
            No gallery faces yet.
          </p>
        ) : (
          <div className="mt-4 grid max-h-96 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
            {faces.map((f) =>
              !f.url ? null : (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelected({ id: f.id, url: f.url! })}
                  className={`aspect-square overflow-hidden rounded-lg border-2 ${
                    selected?.id === f.id ? "border-accent" : "border-transparent hover:border-line-strong"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                </button>
              ),
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-accent">{error}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={confirm}
            disabled={!selected || busy}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Using…" : "Use this face"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrainingPhotosStep({
  personaNotes,
  trainingAssetIds,
  onChangeAssetIds,
  onBack,
  onNext,
}: {
  personaNotes: string;
  trainingAssetIds: Id<"assets">[];
  onChangeAssetIds: (ids: Id<"assets">[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const config = useQuery(api.influencers.config);
  const thumbs = useQuery(
    api.assets.urlsFor,
    trainingAssetIds.length ? { assetIds: trainingAssetIds } : "skip",
  );
  const avatars = useQuery(api.avatars.list);
  const generateFace = useAction(api.influencers.generateFaceImage);
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const min = config?.minTrainingImages ?? 10;
  const have = trainingAssetIds.length;
  const remaining = Math.max(0, min - have);
  const busy = generating || generatingAll || uploading;

  async function addFace() {
    setGenerating(true);
    setError(null);
    try {
      const assetId = await generateFace({ personaNotes });
      onChangeAssetIds([...trainingAssetIds, assetId]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Generates exactly enough faces to clear the minimum, one at a time
   * rather than a single Promise.all -- each success is added to the grid
   * as it lands (same visible progress "Generate a face" already gives you),
   * and a failure partway through keeps whatever already succeeded instead
   * of losing the whole batch.
   */
  async function generateAllFaces() {
    const target = remaining;
    if (target === 0) return;
    setGeneratingAll(true);
    setGenerateAllProgress(0);
    setError(null);
    const generated: Id<"assets">[] = [];
    try {
      for (let i = 0; i < target; i++) {
        const assetId = await generateFace({ personaNotes });
        generated.push(assetId);
        onChangeAssetIds([...trainingAssetIds, ...generated]);
        setGenerateAllProgress(generated.length);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingAll(false);
    }
  }

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError(null);
    try {
      const newIds = await Promise.all(
        Array.from(files).map(async (file) => {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!res.ok) throw new Error(`upload failed (${res.status})`);
          const { storageId } = (await res.json()) as { storageId: string };
          return attach({ storageId: storageId as never, mimeType: file.type, bytes: file.size });
        }),
      );
      onChangeAssetIds([...trainingAssetIds, ...newIds]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  function remove(id: Id<"assets">) {
    onChangeAssetIds(trainingAssetIds.filter((a) => a !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Training photos</p>
        <p className={`font-mono text-xs ${have >= min ? "text-ok" : "text-muted"}`}>
          {have} of {min} minimum
        </p>
      </div>

      {have > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {trainingAssetIds.map((id) => {
            const url = thumbs?.find((t) => t?.id === id)?.url;
            return (
              <div key={id} className="group relative aspect-square overflow-hidden rounded-md border border-line">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="h-full w-full bg-black object-cover" />
                ) : (
                  <div className="h-full w-full animate-pulse bg-surface-sub" />
                )}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label="Remove"
                  className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-xs leading-none text-white opacity-0 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {remaining > 0 && (
          <button
            type="button"
            onClick={generateAllFaces}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {generatingAll
              ? `Generating ${generateAllProgress}/${remaining}…`
              : `Generate all (${remaining})${config ? ` · ~$${(remaining * config.faceImageCostUsd).toFixed(2)}` : ""}`}
          </button>
        )}
        <button
          type="button"
          onClick={addFace}
          disabled={busy}
          className="rounded-md border border-line bg-surface-sub px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
        >
          {generating ? "Generating…" : `Generate a face${config ? ` · ~$${config.faceImageCostUsd.toFixed(2)}` : ""}`}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-md border border-line bg-surface-sub px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Upload photos"}
        </button>
        {avatars !== undefined && avatars.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAvatarPicker((v) => !v)}
            disabled={busy}
            className="rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-foreground disabled:opacity-60"
          >
            + Add from your avatars
          </button>
        )}
      </div>

      {showAvatarPicker && avatars && (
        <div className="grid grid-cols-6 gap-2 rounded-lg border border-line bg-surface-sub p-2">
          {avatars.map((a) => {
            const seedId = a.referenceAssetIds[0];
            const already = seedId ? trainingAssetIds.includes(seedId) : true;
            return (
              <button
                key={a.id}
                type="button"
                disabled={!seedId || already || busy}
                onClick={() => seedId && onChangeAssetIds([...trainingAssetIds, seedId])}
                title={a.name}
                className={`aspect-square overflow-hidden rounded-md border ${
                  already ? "border-line opacity-40" : "border-line hover:border-accent"
                }`}
              >
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imageUrl} alt={a.name} className="h-full w-full bg-black object-cover" />
                ) : (
                  <div className="h-full w-full bg-line-strong" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-accent">{error}</p>}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={have < min || busy}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function TrainStep({
  name,
  personaNotes,
  trainingAssetIds,
  influencerId,
  onCreated,
  onBack,
  onDone,
}: {
  name: string;
  personaNotes: string;
  trainingAssetIds: Id<"assets">[];
  influencerId: Id<"influencers"> | null;
  onCreated: (id: Id<"influencers">) => void;
  onBack: () => void;
  onDone: (id: Id<"influencers">) => void;
}) {
  const config = useQuery(api.influencers.config);
  const spend = useQuery(api.ledger.monthToDate);
  const thumbs = useQuery(api.assets.urlsFor, { assetIds: trainingAssetIds });
  const createInfluencer = useMutation(api.influencers.create);
  const startTraining = useAction(api.influencers.startTraining);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cost = config?.defaultCostUsd ?? 0;
  const overCap = spend !== undefined && cost > spend.remainingUsd;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      let id = influencerId;
      if (!id) {
        id = await createInfluencer({ name, personaNotes, trainingImageAssetIds: trainingAssetIds });
        onCreated(id);
      }
      await startTraining({ influencerId: id });
      onDone(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto">
        {trainingAssetIds.slice(0, 8).map((id) => {
          const url = thumbs?.find((t) => t?.id === id)?.url;
          return url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={id}
              src={url}
              alt=""
              className="h-14 w-14 shrink-0 rounded-md border border-line bg-black object-cover"
            />
          ) : null;
        })}
        {trainingAssetIds.length > 8 && (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line bg-surface-sub font-mono text-xs text-muted">
            +{trainingAssetIds.length - 8}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface-sub p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">Cost</span>
          <span className="text-sm font-semibold">${cost.toFixed(2)}</span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">Time</span>
          <span className="text-sm">~{config?.estimatedMinutes ?? "—"} min</span>
        </div>
        {spend !== undefined && (
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
              Remaining this period
            </span>
            <span className={`text-sm ${overCap ? "text-accent" : ""}`}>
              ${spend.remainingUsd.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {overCap && (
        <p className="text-xs text-accent">
          This would exceed your monthly spend cap. Ask the owner to raise it, or wait for the
          30-day window to roll forward.
        </p>
      )}
      {error && <p className="text-xs text-accent">{error}</p>}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={start}
          disabled={busy || overCap}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Starting…" : "Start training"}
        </button>
      </div>
    </div>
  );
}
