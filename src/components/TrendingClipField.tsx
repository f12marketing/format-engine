"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * P9's picker: a grid over the shared clip library, ingested ahead of time
 * from `dev.ts`'s `ingestTikTokClip` (no admin UI for triggering ingestion
 * yet -- that's the one-afternoon gap here, not this control). Selecting a
 * clip stores its id in config, same as an upload stores an asset id; the
 * pipeline resolves it to a URL server-side when the job actually runs.
 */
export function TrendingClipField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (clipId: string | null) => void;
}) {
  const clips = useQuery(api.clips.list, { limit: 50 });

  if (clips === undefined) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
        Loading clip library…
      </div>
    );
  }

  if (!clips.length) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
        No clips ingested yet. Ask whoever runs the deployment to ingest a few
        trending clips first.
      </div>
    );
  }

  return (
    <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-line bg-surface-sub p-2 sm:grid-cols-4">
      {clips.map((c) => {
        const selected = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(selected ? null : c.id)}
            className={`overflow-hidden rounded-md border text-left transition ${
              selected ? "border-accent ring-2 ring-accent" : "border-line hover:border-accent"
            }`}
          >
            {c.url ? (
              <video
                src={c.url}
                muted
                loop
                playsInline
                className="aspect-[9/16] w-full bg-black object-cover"
                onMouseEnter={(e) => e.currentTarget.play()}
                onMouseLeave={(e) => e.currentTarget.pause()}
              />
            ) : (
              <div className="aspect-[9/16] w-full bg-line-strong" />
            )}
            <p className="truncate px-1.5 py-1 font-mono text-[0.6rem] text-muted">
              {c.creatorHandle ? `@${c.creatorHandle}` : c.source}
            </p>
          </button>
        );
      })}
    </div>
  );
}
