"use client";

import { useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * P10's picker: a grid over the roster (the client's own avatars plus the
 * shared house roster), with inline creation so picking an avatar and making
 * a new one are the same control rather than a trip to a separate page that
 * doesn't exist yet.
 */
export function AvatarField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (avatarId: string | null) => void;
}) {
  const avatars = useQuery(api.avatars.list);
  const [creating, setCreating] = useState(false);

  if (avatars === undefined) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
        Loading roster…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {avatars.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {avatars.map((a) => {
            const selected = value === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(selected ? null : a.id)}
                className={`overflow-hidden rounded-md border text-left transition ${
                  selected ? "border-accent ring-2 ring-accent" : "border-line hover:border-accent"
                }`}
              >
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt={a.name}
                    className="aspect-square w-full bg-black object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full bg-line-strong" />
                )}
                <p className="truncate px-1 py-0.5 font-mono text-[0.55rem] text-muted">
                  {a.name}
                  {a.house && " · house"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {creating ? (
        <NewAvatarForm
          onCreated={(id) => {
            onChange(id);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full rounded-lg border border-dashed border-line py-2 text-xs text-muted hover:border-accent hover:text-foreground"
        >
          + New avatar
        </button>
      )}
    </div>
  );
}

function NewAvatarForm({
  onCreated,
  onCancel,
}: {
  onCreated: (avatarId: string) => void;
  onCancel: () => void;
}) {
  const generate = useAction(api.avatars.generate);
  const [name, setName] = useState("");
  const [lookNotes, setLookNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !lookNotes.trim()) {
      setError("Give it a name and a description of how it looks.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await generate({ name: name.trim(), lookNotes: lookNotes.trim() });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-sub p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, e.g. Mia"
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />
      <textarea
        value={lookNotes}
        onChange={(e) => setLookNotes(e.target.value)}
        rows={3}
        placeholder="How they look: age range, style, vibe. This becomes the reference portrait -- a synthetic persona, not a real person's photo."
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />
      {error && <p className="text-xs text-accent">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate portrait"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
