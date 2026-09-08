"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const STATUS_CLASS: Record<string, string> = {
  ready: "text-ok border-ok",
  failed: "text-accent border-accent",
  training: "text-warn border-warn",
  draft: "text-muted border-line",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide ${
        STATUS_CLASS[status] ?? "text-muted border-line"
      }`}
    >
      {status}
    </span>
  );
}

/**
 * The influencer roster: trained personas alongside the format engine's
 * regular jobs. Same section shape as "Recent jobs" on the dashboard --
 * heading, then a list -- rather than a new page, since sixteen new nav
 * destinations is exactly the wall FormatPicker's own comment warns against
 * for formats. The create button lives up top next to "+ Create new
 * content" instead of here; this component is reactive either way, so a
 * training that finishes shows up here on its own.
 */
export function InfluencerRoster() {
  const influencers = useQuery(api.influencers.list);

  return (
    <div className="mt-10">
      <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Influencers
      </h2>

      {influencers === undefined ? (
        <div className="mt-2 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : influencers.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          No influencers yet. Create one to train a reusable persona.
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {influencers.map((inf) => (
            <li
              key={inf._id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{inf.name}</span>
                <span className="block font-mono text-xs text-muted">
                  {inf.trainingImageAssetIds.length} training photos
                  {inf.costUsd !== undefined ? ` · $${inf.costUsd.toFixed(2)}` : ""}
                </span>
                {inf.status === "failed" && inf.error && (
                  <span className="mt-0.5 block text-xs text-accent">{inf.error}</span>
                )}
              </span>
              <StatusPill status={inf.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
