"use client";

import { useState } from "react";
import { InfluencerRoster } from "@/components/InfluencerRoster";
import { NewInfluencerModal } from "@/components/NewInfluencerModal";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { backendConfigured } from "@/app/ConvexClientProvider";

/**
 * The roster gets its own destination now that it's a sidebar item, rather
 * than a section under the dashboard's job list.
 *
 * The reference design's credits balance and "Buy more" are deliberately
 * left out: spend here is tracked in USD on `spend_ledger`, and a second,
 * fictional currency on top of it would be a lie in the UI.
 */
export default function InfluencersPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-surface p-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Influencers</h1>
          <p className="mt-1 text-sm text-muted">
            Persistent AI characters: train once, generate endlessly.
          </p>
        </div>
        {backendConfigured && (
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            + New influencer
          </button>
        )}
      </section>

      <section className="mt-4">
        {backendConfigured ? (
          <AuthorisedBoundary>
            <InfluencerRoster onCreate={() => setModalOpen(true)} />
          </AuthorisedBoundary>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">
            <p className="font-medium text-foreground">Backend not connected yet</p>
            <p className="mt-1">
              Run <code className="font-mono text-xs">npx convex dev</code> and add your Supabase
              keys to <code className="font-mono text-xs">.env.local</code>.
            </p>
          </div>
        )}
      </section>

      {modalOpen && (
        <NewInfluencerModal onClose={() => setModalOpen(false)} onCreated={() => {}} />
      )}
    </main>
  );
}
