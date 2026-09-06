"use client";

import { useState } from "react";
import Link from "next/link";
import { ConfigPanel } from "@/components/ConfigPanel";
import { PreviewPanel } from "@/components/PreviewPanel";
import { estimateCost } from "@/lib/estimate";
import type { Field, FormatDefinition } from "@/formats/types";

/** Seed from each field's declared default, so the panel opens usable. */
function initialValues(format: FormatDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(format.config) as [string, Field][]) {
    if ("default" in field && field.default !== undefined) out[key] = field.default;
  }
  return out;
}

export function Editor({ format }: { format: FormatDefinition }) {
  const [values, setValues] = useState(() => initialValues(format));
  const [running] = useState(false);

  const estimate = estimateCost(format, values);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href="/"
        className="font-mono text-xs text-muted hover:text-accent"
      >
        ← All formats
      </Link>

      <header className="mt-3 flex items-center gap-3">
        <span className="text-2xl leading-none">{format.icon}</span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{format.name}</h1>
          <p className="text-sm text-muted">{format.blurb}</p>
        </div>
      </header>

      {/* Configuration left, preview right -- the layout from the spec. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <ConfigPanel
            format={format}
            values={values}
            onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
          />

          {/*
            The cost sits next to the button, not in a settings page. With
            remix regenerating assets and duration freely selectable, this
            number is the only brake on spend -- so it ships in Phase 0.
          */}
          <div className="mt-8 rounded-xl border border-line bg-surface-sub p-4">
            <ul className="space-y-1.5 text-sm">
              {estimate.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-4">
                  <span className="text-muted">{l.label}</span>
                  <span className="font-mono tabular-nums">
                    {l.costUsd > 0 ? `$${l.costUsd.toFixed(3)}` : "Free"}
                  </span>
                </li>
              ))}
              <li className="flex justify-between gap-4 border-t border-line-strong pt-2 font-semibold">
                <span>Estimated</span>
                <span className="font-mono tabular-nums">
                  ${estimate.totalUsd.toFixed(2)}
                </span>
              </li>
            </ul>
          </div>

          <button
            disabled
            title="Needs a Convex deployment — see README"
            className="mt-4 w-full cursor-not-allowed rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white opacity-60"
          >
            Generate · ${estimate.totalUsd.toFixed(2)}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            Connect Convex to enable. The estimate above is live.
          </p>
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
            {running ? "Progress" : "Preview"}
          </h2>
          <PreviewPanel format={format} values={values} running={running} />
        </aside>
      </div>
    </main>
  );
}
