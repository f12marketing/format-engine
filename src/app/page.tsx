"use client";

import Link from "next/link";
import { FORMATS } from "@/formats";
import type { FormatDefinition } from "@/formats/types";

/**
 * The format picker, as the app's landing page rather than a modal over a
 * dashboard. Flat grid, no group headings: the reference layout puts every
 * format on one wall and lets the thumbnails do the sorting.
 *
 * Planned formats stay visible but unclickable -- the registry lists itself,
 * and a visible roadmap beats a hidden one.
 */
export default function ContentPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Create new content</h1>
      <p className="mt-1 text-sm text-muted">
        Pick a format to get started. You can switch anytime.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FORMATS.map((format) => (
          <FormatCard key={format.id} format={format} />
        ))}
      </div>
    </main>
  );
}

function FormatCard({ format }: { format: FormatDefinition }) {
  const ready = format.status === "ready";

  const body = (
    <>
      <div className="grid aspect-[4/3] place-items-center bg-surface-sub text-5xl">
        {format.icon}
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{format.name}</span>
          {format.shipsToday && (
            <span className="shrink-0 rounded border border-accent bg-accent-soft px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wide text-accent">
              today
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{format.blurb}</p>
        {!ready && (
          <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Phase {format.phase}
          </p>
        )}
      </div>
    </>
  );

  if (!ready) {
    return (
      <div
        title={`Arrives in Phase ${format.phase}`}
        className="cursor-not-allowed overflow-hidden rounded-xl border border-line bg-surface opacity-55"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/new/${format.id}`}
      className="overflow-hidden rounded-xl border border-line bg-surface transition hover:border-accent"
    >
      {body}
    </Link>
  );
}
