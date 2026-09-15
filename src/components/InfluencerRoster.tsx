"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { StatusPill } from "@/components/StatusPill";

/**
 * The trained-persona roster. Reactive, so a training that finishes appears
 * here on its own without the page knowing to refetch.
 */
export function InfluencerRoster({ onCreate }: { onCreate: () => void }) {
  const influencers = useQuery(api.influencers.list);

  if (influencers === undefined) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (influencers.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface px-6 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <svg
            className="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="12" cy="10" r="2.6" />
            <path d="M7 18a5 5 0 0 1 10 0" />
          </svg>
        </span>
        <h2 className="mt-4 text-base font-semibold">Create your first AI influencer</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          Pick traits, generate a base character, and our agents will train a persistent character
          you can reuse across every piece of content.
        </p>
        <button
          onClick={onCreate}
          className="mt-5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          + New influencer
        </button>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
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
  );
}
