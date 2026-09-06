"use client";

import { useState } from "react";
import { FormatPicker } from "@/components/FormatPicker";
import { FORMATS } from "@/formats";

export default function Dashboard() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ready = FORMATS.filter((f) => f.status === "ready").length;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Format Engine</h1>
        <span className="font-mono text-xs text-muted">
          {ready} of {FORMATS.length} formats live
        </span>
      </header>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
      >
        + Create new content
      </button>

      <h2 className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Recent jobs
      </h2>
      <div className="mt-2 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
        No jobs yet. Convex isn&rsquo;t connected — run{" "}
        <code className="font-mono text-xs">npx convex dev</code> to wire the
        job list up.
      </div>

      {pickerOpen && <FormatPicker onClose={() => setPickerOpen(false)} />}
    </main>
  );
}
