"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

interface Character {
  character_id: string;
  name: string;
  description: string;
  image_url?: string;
}
interface Background {
  bg_id: string;
  name: string;
  description: string;
  image_url?: string;
}
interface Shot {
  shot_id: string;
  scene_title: string;
  action: string;
  camera_movement: string;
  dialogue: string;
  background: string;
  characters: string[];
}

/**
 * The three Video Animation gates, in one component keyed by step id.
 *
 * A gate is a job sitting at `status: "awaiting_approval"` with one step in
 * that same state -- the workflow is genuinely suspended via
 * `step.awaitEvent`, consuming nothing, until `jobs.approveStep` fires the
 * matching event. Story is the only one with inline editing in this first
 * pass; characters and shots are read-only review for now, same as the
 * README's other "known gaps" -- editing structured JSON inline is a real
 * UI investment, not a missing afternoon.
 */
export function ApprovalGate({
  jobId,
  stepId,
  output,
}: {
  jobId: Id<"jobs">;
  stepId: string;
  output: unknown;
}) {
  const approve = useMutation(api.jobs.approveStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState(
    () => (output as { markdown?: string } | undefined)?.markdown ?? "",
  );

  async function onApprove(edits?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await approve({ jobId, stepId, edits });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-accent bg-accent-soft p-4">
      <p className="mb-3 text-sm font-semibold text-accent">
        Review and approve to continue
      </p>

      {stepId === "story" && (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={16}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed"
        />
      )}

      {stepId === "characters" && <CharactersReview output={output} />}
      {stepId === "shots" && <ShotsReview output={output} />}

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      <button
        onClick={() =>
          onApprove(stepId === "story" ? { markdown } : undefined)
        }
        disabled={busy}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Approving…" : "Approve and continue"}
      </button>
    </div>
  );
}

function CharactersReview({ output }: { output: unknown }) {
  const data = output as { characters?: Character[]; backgrounds?: Background[] } | undefined;
  const characters = data?.characters ?? [];
  const backgrounds = data?.backgrounds ?? [];
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
          Characters — {characters.length}
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {characters.map((c) => (
            <figure key={c.character_id} className="text-center">
              {c.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.image_url}
                  alt={c.name}
                  className="aspect-square w-full rounded-lg border border-line object-cover"
                />
              )}
              <figcaption className="mt-1 truncate text-xs">{c.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
          Backgrounds — {backgrounds.length}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {backgrounds.map((b) => (
            <figure key={b.bg_id}>
              {b.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.image_url}
                  alt={b.name}
                  className="aspect-video w-full rounded-lg border border-line object-cover"
                />
              )}
              <figcaption className="mt-1 truncate text-xs">{b.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShotsReview({ output }: { output: unknown }) {
  const shots = (output as { shots?: Shot[] } | undefined)?.shots ?? [];
  return (
    <div>
      <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
        Shots — {shots.length}
      </p>
      <ol className="max-h-96 space-y-2 overflow-y-auto">
        {shots.map((s, i) => (
          <li key={s.shot_id} className="rounded-lg border border-line bg-surface p-2.5 text-sm">
            <p className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
              {i + 1}. {s.scene_title} · {s.camera_movement}
            </p>
            <p className="mt-1">{s.action}</p>
            {s.dialogue && <p className="mt-1 italic text-muted">&ldquo;{s.dialogue}&rdquo;</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
