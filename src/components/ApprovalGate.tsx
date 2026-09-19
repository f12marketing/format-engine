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

/** Drama's episode, as convex/drama.ts hands it from step to step. */
interface DramaCharacter {
  id: string;
  name: string;
  role: string;
  image_url?: string;
  voice_url?: string;
}
interface DramaBeat {
  n: number;
  location: string;
  kind: "dialogue" | "narration" | "action";
  speaker: string;
  line: string;
  emotion: string;
  action: string;
  camera: string;
  seconds: number;
  frame_url?: string;
}
interface DramaEpisode {
  title: string;
  logline: string;
  aspectRatio?: string;
  characters: DramaCharacter[];
  locations: { id: string; name: string; image_url?: string }[];
  beats: DramaBeat[];
}

/**
 * Every format's approval gates, in one component keyed by step id: Video
 * Animation's three, Drama's three (script, cast, storyboard) and Product
 * Spokesperson's one. Step ids don't collide across formats, so the id alone
 * says which review to show.
 *
 * A gate is a job sitting at `status: "awaiting_approval"` with one step in
 * that same state -- the workflow is genuinely suspended via
 * `step.awaitEvent`, consuming nothing, until `jobs.approveStep` fires the
 * matching event. Story and Drama's script are the ones with inline
 * editing; the rest are read-only review for now, same as the README's
 * other "known gaps" -- editing structured JSON inline is a real UI
 * investment, not a missing afternoon.
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
  // Drama's script gate edits lines in place, so it approves a whole
  // (possibly edited) episode rather than the output it was handed.
  const [episode, setEpisode] = useState(() => output as DramaEpisode | undefined);

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
      {stepId === "composite" && <CompositeReview output={output} />}
      {stepId === "script" && episode && (
        <DramaScriptReview episode={episode} onChange={setEpisode} />
      )}
      {stepId === "cast" && <DramaCastReview output={output} />}
      {stepId === "storyboard" && <DramaStoryboardReview output={output} />}

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      <button
        onClick={() =>
          onApprove(
            stepId === "story" ? { markdown } : stepId === "script" ? episode : undefined,
          )
        }
        disabled={busy}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Approving…" : "Approve and continue"}
      </button>
    </div>
  );
}

/** Product Spokesperson's single gate: the composited still, before paying for P5 on top of it. */
function CompositeReview({ output }: { output: unknown }) {
  const imageUrl = (output as { imageUrl?: string } | undefined)?.imageUrl;
  if (!imageUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt="Composited spokesperson"
      className="w-full max-w-sm rounded-lg border border-line object-cover"
    />
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

const reviewLabel = "mb-2 font-mono text-[0.6rem] uppercase tracking-wide text-muted";
const reviewInput =
  "w-full rounded-md border border-line bg-surface-sub px-2 py-1.5 text-sm outline-none focus:border-accent";

/**
 * Drama's script gate. The lines and the action are what people actually
 * want to fix before anything is drawn, so those two are editable; the
 * cast, sets and beat structure stay as written -- rewiring who is on
 * screen by hand is a job for a regenerate, not a textarea.
 */
function DramaScriptReview({
  episode,
  onChange,
}: {
  episode: DramaEpisode;
  onChange: (next: DramaEpisode) => void;
}) {
  const names = new Map(episode.characters.map((c) => [c.id, c.name]));
  const places = new Map(episode.locations.map((l) => [l.id, l.name]));
  const totalSeconds = episode.beats.reduce((sum, b) => sum + b.seconds, 0);

  function editBeat(n: number, patch: Partial<DramaBeat>) {
    onChange({
      ...episode,
      beats: episode.beats.map((b) => (b.n === n ? { ...b, ...patch } : b)),
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-base font-semibold">{episode.title}</p>
        <p className="mt-0.5 text-sm text-muted">{episode.logline}</p>
      </div>

      <div>
        <p className={reviewLabel}>Cast — {episode.characters.length}</p>
        <ul className="flex flex-wrap gap-1.5">
          {episode.characters.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-muted"> · {c.role}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className={reviewLabel}>
          Beats — {episode.beats.length} · ~{totalSeconds}s
        </p>
        <ol className="max-h-[28rem] space-y-2 overflow-y-auto">
          {episode.beats.map((b) => (
            <li key={b.n} className="rounded-lg border border-line bg-surface p-2.5 text-sm">
              <p className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
                {b.n}. {places.get(b.location) ?? b.location} · {b.camera} · {b.seconds}s
              </p>
              <textarea
                value={b.action}
                onChange={(e) => editBeat(b.n, { action: e.target.value })}
                rows={2}
                aria-label={`Beat ${b.n} action`}
                className={`mt-1.5 ${reviewInput}`}
              />
              {b.kind !== "action" && (
                <div className="mt-1.5">
                  <p className="mb-1 text-xs">
                    <span className="font-semibold">
                      {b.kind === "narration" ? "Narrator" : (names.get(b.speaker) ?? b.speaker)}
                    </span>
                    {b.emotion && <span className="italic text-muted"> — {b.emotion}</span>}
                  </p>
                  <textarea
                    value={b.line}
                    onChange={(e) => editBeat(b.n, { line: e.target.value })}
                    rows={2}
                    aria-label={`Beat ${b.n} line`}
                    className={reviewInput}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Drama's cast gate: every face and voice the episode will reuse, before a frame is drawn. */
function DramaCastReview({ output }: { output: unknown }) {
  const ep = output as DramaEpisode | undefined;
  if (!ep) return null;
  return (
    <div className="space-y-4">
      <div>
        <p className={reviewLabel}>Cast — {ep.characters.length}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ep.characters.map((c) => (
            <figure key={c.id}>
              {c.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.image_url}
                  alt={c.name}
                  className="aspect-[3/4] w-full rounded-lg border border-line object-cover"
                />
              )}
              <figcaption className="mt-1 truncate text-xs">
                <span className="font-semibold">{c.name}</span>
                <span className="text-muted"> · {c.role}</span>
              </figcaption>
              {c.voice_url && (
                <audio src={c.voice_url} controls preload="none" className="mt-1 h-8 w-full" />
              )}
            </figure>
          ))}
        </div>
      </div>
      <div>
        <p className={reviewLabel}>Sets — {ep.locations.length}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ep.locations.map((l) => (
            <figure key={l.id}>
              {l.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.image_url}
                  alt={l.name}
                  className="w-full rounded-lg border border-line object-cover"
                  style={{ aspectRatio: (ep.aspectRatio ?? "9:16").replace(":", " / ") }}
                />
              )}
              <figcaption className="mt-1 truncate text-xs">{l.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Drama's last gate, and the one that matters for spend: nothing is filmed until this is approved. */
function DramaStoryboardReview({ output }: { output: unknown }) {
  const ep = output as DramaEpisode | undefined;
  if (!ep) return null;
  const names = new Map(ep.characters.map((c) => [c.id, c.name]));
  const portrait = (ep.aspectRatio ?? "9:16") === "9:16";
  return (
    <div>
      <p className={reviewLabel}>Storyboard — {ep.beats.length} frames</p>
      <ol
        className={`grid max-h-[32rem] gap-3 overflow-y-auto ${
          portrait ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
        }`}
      >
        {ep.beats.map((b) => (
          <li key={b.n}>
            {b.frame_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={b.frame_url}
                alt={`Beat ${b.n}`}
                className="w-full rounded-lg border border-line object-cover"
                style={{ aspectRatio: (ep.aspectRatio ?? "9:16").replace(":", " / ") }}
              />
            )}
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
              {b.n} · {b.seconds}s
            </p>
            {b.line && (
              <p className="line-clamp-2 text-xs">
                <span className="font-semibold">
                  {b.kind === "narration" ? "Narrator" : (names.get(b.speaker) ?? "")}:
                </span>{" "}
                {b.line}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
