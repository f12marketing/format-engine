"use client";

import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getFormat } from "@/formats";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { StatusPill } from "@/components/StatusPill";

/**
 * Every job, not just the dashboard's most-recent-25 strip. Paginated rather
 * than one big `.collect()` -- a client running this for months will have
 * more jobs than any page should load at once.
 */
export default function HistoryPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Job history</h1>

      <AuthorisedBoundary>
        <HistoryList />
      </AuthorisedBoundary>
    </main>
  );
}

/**
 * Split out from `HistoryPage` so `AuthorisedBoundary` sits above the hook
 * that can throw -- the static header above it has nothing to do with auth
 * and shouldn't disappear if the query below it isn't authorised yet.
 */
function HistoryList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.jobs.history,
    {},
    { initialNumItems: 25 },
  );

  return (
    <>
      {status === "LoadingFirstPage" ? (
        <div className="mt-6 rounded-xl border border-line p-6 text-sm text-muted">
          Loading…
        </div>
      ) : !results.length ? (
        <div className="mt-6 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No jobs yet.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {results.map((job) => {
            const format = getFormat(job.formatId);
            const done = job.steps.filter((s) => s.state === "done").length;
            return (
              <li key={job._id}>
                <Link
                  href={`/jobs/${job._id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="text-lg leading-none">{format?.icon ?? "•"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {format?.name ?? job.formatId}
                      {job.remixedFromJobId && (
                        <span className="ml-2 font-mono text-[0.6rem] font-normal uppercase tracking-wide text-muted">
                          remix
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-xs text-muted">
                      {done} / {job.steps.length} steps · ${job.costUsd.toFixed(3)} ·{" "}
                      {new Date(job._creationTime).toLocaleString()}
                    </span>
                  </span>
                  <StatusPill status={job.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <button
          onClick={() => loadMore(25)}
          className="mt-4 w-full rounded-lg border border-line bg-surface-sub py-2 text-sm text-muted hover:border-accent hover:text-foreground"
        >
          Load more
        </button>
      )}
      {status === "LoadingMore" && (
        <p className="mt-4 text-center text-sm text-muted">Loading more…</p>
      )}
    </>
  );
}

