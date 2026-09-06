"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FORMATS, GROUPS } from "@/formats";
import type { FormatDefinition } from "@/formats/types";

/**
 * The picker. Every format lives here -- including the three that ship in the
 * old app today -- so there is no privileged route for anything that happened
 * to be built first.
 *
 * Grouped by what comes out rather than by which model runs, because that is
 * how the choice is actually made: you know whether you want a deck, a talking
 * head or a generated scene before you know which model does it. Sixteen tiles
 * in one flat grid is a wall, and it only gets worse as formats are added.
 */
export function FormatPicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Escape closes. Added from the start because by format eight you are
  // scanning this list, and by sixteen you are hunting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FORMATS;
    return FORMATS.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.blurb.toLowerCase().includes(q),
    );
  }, [query]);

  const pick = (f: FormatDefinition) => {
    if (f.status !== "ready") return;
    router.push(`/new/${f.id}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="picker-title" className="text-lg font-semibold">
              Create new content
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Pick a format to start · {FORMATS.length} available
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-surface-sub hover:text-foreground"
          >
            ×
          </button>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search formats…"
          className="mt-4 w-full rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <div className="mt-5 space-y-5">
          {GROUPS.map((group) => {
            const items = matches.filter((f) => f.group === group.id);
            if (!items.length) return null;
            return (
              <section key={group.id}>
                <h3 className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
                  {group.label}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((f) => (
                    <FormatCard key={f.id} format={f} onPick={pick} />
                  ))}
                </div>
              </section>
            );
          })}
          {!matches.length && (
            <p className="py-6 text-center text-sm text-muted">
              Nothing matches “{query}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FormatCard({
  format,
  onPick,
}: {
  format: FormatDefinition;
  onPick: (f: FormatDefinition) => void;
}) {
  const ready = format.status === "ready";
  return (
    <button
      type="button"
      onClick={() => onPick(format)}
      disabled={!ready}
      title={ready ? undefined : `Arrives in Phase ${format.phase}`}
      className={[
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
        ready
          ? "cursor-pointer border-line bg-surface-sub hover:border-accent"
          : "cursor-not-allowed border-line bg-surface-sub opacity-55",
      ].join(" ")}
    >
      <span className="text-xl leading-none">{format.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">{format.name}</span>
          {format.shipsToday && (
            <span className="rounded border border-accent bg-accent-soft px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wide text-accent">
              today
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">
          {format.blurb}
        </span>
        {!ready && (
          <span className="mt-1 block font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            Phase {format.phase}
          </span>
        )}
      </span>
    </button>
  );
}
