"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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

  const STEP_LABELS = ["Persona", "Training photos", "Train"];

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
            <PersonaStep
              name={name}
              personaNotes={personaNotes}
              onChangeName={setName}
              onChangePersonaNotes={setPersonaNotes}
              onNext={() => setStep(2)}
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

function PersonaStep({
  name,
  personaNotes,
  onChangeName,
  onChangePersonaNotes,
  onNext,
  onCancel,
}: {
  name: string;
  personaNotes: string;
  onChangeName: (v: string) => void;
  onChangePersonaNotes: (v: string) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const canContinue = name.trim().length > 0 && personaNotes.trim().length > 0;
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="e.g. Mia"
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
          Persona
        </label>
        <textarea
          value={personaNotes}
          onChange={(e) => onChangePersonaNotes(e.target.value)}
          rows={4}
          placeholder="How they look and act: age range, style, vibe, tone of voice. This guides both the generated face and any copy written for them -- a synthetic persona, not a real person's likeness."
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>
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
          onClick={onNext}
          disabled={!canContinue}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          Continue
        </button>
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
  const [uploading, setUploading] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const min = config?.minTrainingImages ?? 10;
  const have = trainingAssetIds.length;

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
        <button
          type="button"
          onClick={addFace}
          disabled={generating}
          className="rounded-md border border-line bg-surface-sub px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
        >
          {generating ? "Generating…" : `Generate a face${config ? ` · ~$${config.faceImageCostUsd.toFixed(2)}` : ""}`}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-line bg-surface-sub px-3 py-1.5 text-xs hover:border-accent disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Upload photos"}
        </button>
        {avatars !== undefined && avatars.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAvatarPicker((v) => !v)}
            className="rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-foreground"
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
                disabled={!seedId || already}
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
          disabled={have < min}
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
