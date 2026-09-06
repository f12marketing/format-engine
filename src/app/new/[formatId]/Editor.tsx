"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { backendConfigured } from "@/app/ConvexClientProvider";
import { ConfigPanel } from "@/components/ConfigPanel";
import { PreviewPanel } from "@/components/PreviewPanel";
import { estimateCost } from "@/lib/estimate";
import { stepApplies } from "@/formats/types";
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
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(format));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = useMutation(api.run.generate);

  const estimate = estimateCost(format, values);

  async function onGenerate() {
    setError(null);
    setRunning(true);
    try {
      // Only the steps that will actually run are sent, so the job's step list
      // matches what happens rather than what the format could do.
      const steps = format.pipeline
        .filter((step) => stepApplies(step, values))
        .map((step) => ({ id: step.id, primitive: step.primitive, label: step.label }));

      const jobId = await generate({ formatId: format.id, config: values, steps });
      router.push(`/jobs/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

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
            onClick={onGenerate}
            disabled={!backendConfigured || running}
            title={backendConfigured ? undefined : "Needs a Convex deployment — see README"}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Starting…" : `Generate · $${estimate.totalUsd.toFixed(2)}`}
          </button>
          {error && <p className="mt-2 text-sm text-accent">{error}</p>}
          {!backendConfigured && (
            <p className="mt-2 text-center text-xs text-muted">
              Connect Convex to enable. The estimate above is live.
            </p>
          )}
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
