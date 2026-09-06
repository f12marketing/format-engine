"use client";

import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getFormat } from "@/formats";

/**
 * Every job, not just the dashboard's most-recent-25 strip. Paginated rather
 * than one big `.collect()` -- a client running this for months will have
 * more jobs than any page should load at once.
 */
export default function HistoryPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.jobs.history,
    {},
    { initialNumItems: 25 },
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="font-mono text-xs text-muted hover:text-accent">
        ← Dashboard
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Job history</h1>

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
    </main>
  );
}

const STATUS_CLASS: Record<string, string> = {
  done: "text-ok border-ok",
  failed: "text-accent border-accent",
  running: "text-warn border-warn",
  awaiting_approval: "text-warn border-warn",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide ${
        STATUS_CLASS[status] ?? "text-muted border-line"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
