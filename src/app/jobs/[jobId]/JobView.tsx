"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getFormat } from "@/formats";

/**
 * The run, watched live.
 *
 * No polling and no refresh button: this is a Convex subscription, so each
 * step the workflow writes arrives here on its own. These runs take minutes,
 * and showing which of five steps you are on is the difference between
 * "working" and "broken".
 */
export function JobView({ jobId }: { jobId: string }) {
  const job = useQuery(api.jobs.get, { jobId: jobId as Id<"jobs"> });
  const assets = useQuery(api.assets.forJob, { jobId: jobId as Id<"jobs"> });

  if (job === undefined) {
    return <Shell><p className="text-sm text-muted">Loading…</p></Shell>;
  }
  if (job === null) {
    return <Shell><p className="text-sm text-muted">Job not found.</p></Shell>;
  }

  const format = getFormat(job.formatId);
  const deck = job.steps.find((s) => s.id === "copy")?.output as
    | { title?: string; slides?: unknown[]; caption?: string; hashtags?: string[] }
    | undefined;
  const files = (job.steps.find((s) => s.id === "render")?.output as
    | { files?: { name: string }[] }
    | undefined)?.files;

  return (
    <Shell>
      <header className="flex items-center gap-3">
        <span className="text-2xl leading-none">{format?.icon ?? "•"}</span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {format?.name ?? job.formatId}
          </h1>
          <p className="font-mono text-xs text-muted">
            {job.status} · ${job.costUsd.toFixed(4)}
          </p>
        </div>
      </header>

      {job.error && (
        <p className="mt-4 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent">
          {job.error}
        </p>
      )}

      <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Steps
      </h2>
      <ol className="mt-2 space-y-2">
        {job.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-sub px-3 py-2"
          >
            <StepDot state={step.state} />
            <span className="flex-1 text-sm">{step.label}</span>
            <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
              {step.primitive} · {step.state}
            </span>
          </li>
        ))}
      </ol>

      {deck?.slides?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Deck — {deck.slides.length} slides
          </h2>
          <ol className="mt-2 space-y-2">
            {(deck.slides as Record<string, string>[]).map((s, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface p-3">
                {s.kicker && (
                  <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                    {s.kicker}
                  </p>
                )}
                <p className="text-sm font-semibold">{s.headline}</p>
                {s.body && <p className="mt-1 text-sm text-muted">{s.body}</p>}
                {s.swipe_cue && (
                  <p className="mt-1 text-xs italic text-muted">{s.swipe_cue}</p>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {assets?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Output — {assets.length} files
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {assets.map((a) =>
              a.url ? (
                <li key={a.id}>
                  <a
                    href={a.url}
                    download
                    className="block rounded-md border border-line bg-surface-sub px-2 py-1 font-mono text-xs hover:border-accent"
                  >
                    {a.kind} · {(a.bytes / 1024).toFixed(0)}kB
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </>
      ) : files?.length ? (
        <>
          <h2 className="mt-8 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            Rendered
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <li
                key={f.name}
                className="rounded-md border border-line bg-surface-sub px-2 py-1 font-mono text-xs"
              >
                {f.name}
              </li>
            ))}
          </ul>
        </>
      ) : null}

    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <Link href="/" className="font-mono text-xs text-muted hover:text-accent">
        ← Dashboard
      </Link>
      <div className="mt-3">{children}</div>
    </main>
  );
}

const DOT: Record<string, string> = {
  done: "bg-ok",
  running: "bg-warn animate-pulse",
  failed: "bg-accent",
  skipped: "bg-line-strong",
  pending: "bg-line-strong",
};

function StepDot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      className={`size-2.5 shrink-0 rounded-full ${DOT[state] ?? "bg-line-strong"}`}
    />
  );
}
