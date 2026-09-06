"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getFormat } from "@/formats";

/**
 * Reactive by default: this subscribes to the jobs table rather than polling,
 * so a workflow writing its step progress updates the list as it runs. There
 * is no refresh button because there is nothing to refresh.
 */
export function JobList() {
  const jobs = useQuery(api.jobs.list, { limit: 25 });

  if (jobs === undefined) {
    return (
      <div className="mt-2 rounded-xl border border-line p-6 text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!jobs.length) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
        No jobs yet. Create your first one above.
      </div>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {jobs.map((job) => {
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
                </span>
                <span className="block font-mono text-xs text-muted">
                  {done} / {job.steps.length} steps · ${job.costUsd.toFixed(3)}
                </span>
              </span>
              <StatusPill status={job.status} />
            </Link>
          </li>
        );
      })}
    </ul>
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
