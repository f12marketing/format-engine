"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  authConfigured,
  backendConfigured,
  convexConfigured,
} from "@/app/ConvexClientProvider";
import { ConfigPanel } from "@/components/ConfigPanel";
import { PreviewPanel } from "@/components/PreviewPanel";
import { estimateCost } from "@/lib/estimate";
import { effectiveConfig, missingRequired, stepApplies } from "@/formats/types";
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

  // What runs is what is on screen: a field the panel is hiding contributes
  // nothing to the estimate, the steps or the config frozen onto the job.
  // Without this, switching Voiceover off after switching Subtitles on would
  // still bill a subtitle pass for a card the user can no longer see.
  const effective = effectiveConfig(format, values);
  const estimate = estimateCost(format, effective);
  // A field the format marks `required` (Script, for the two formats that are
  // cut to it) keeps Generate off until it has text -- a job started without
  // it would only fail on its first step.
  const missing = missingRequired(format, values);
  // "Mention your business" writes from the saved profile in every format, so
  // with no profile there is nothing for it to mention -- the card under the
  // toggle asks for one, and Generate waits for it.
  const brand = useQuery(api.brands.mine, convexConfigured ? {} : "skip");
  const needsProfile =
    Boolean(effective.mentionBusiness) && brand !== undefined && !brand?.description;
  const blocked = missing.length > 0 || needsProfile;

  async function onGenerate() {
    if (blocked) return;
    setError(null);
    setRunning(true);
    try {
      // Only the steps that will actually run are sent, so the job's step list
      // matches what happens rather than what the format could do.
      const steps = format.pipeline
        .filter((step) => stepApplies(step, effective))
        .map((step) => ({ id: step.id, primitive: step.primitive, label: step.label }));

      const jobId = await generate({ formatId: format.id, config: effective, steps });
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
            disabled={!backendConfigured || running || blocked}
            title={backendConfigured ? undefined : "Needs Convex and Supabase Auth — see README"}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Starting…" : `Generate · $${estimate.totalUsd.toFixed(2)}`}
          </button>
          {missing.length > 0 && (
            <p className="mt-2 text-center text-xs text-muted">
              Add {missing.map((m) => m.label).join(" and ")} to generate.
            </p>
          )}
          {missing.length === 0 && needsProfile && (
            <p className="mt-2 text-center text-xs text-muted">
              Take the business quiz above, or switch Mention your business off.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-accent">{error}</p>}
          {!backendConfigured && (
            <p className="mt-2 text-center text-xs text-muted">
              {convexConfigured && !authConfigured
                ? "Needs Supabase Auth — a job belongs to a signed-in client."
                : "Connect Convex to enable."}{" "}
              The estimate above is live.
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
