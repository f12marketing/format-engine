"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import {
  BUSINESS_MODELS,
  CATEGORIES,
  GOALS,
  INTENTS,
  REVENUE_BANDS,
  ROLES,
  SOURCES,
  TEAM_SIZES,
  TEXT_LIMITS,
} from "../../../convex/lib/businessQuiz";
import {
  BrandBrief,
  Chips,
  cleanError,
  EMPTY_PROFILE,
  inputClass,
  Labelled,
  LogoField,
  ToneField,
  toSave,
  type ProfileForm,
} from "./profile";

type Brand = NonNullable<FunctionReturnType<typeof api.brands.mine>>;

/**
 * The Business page: every answer from the sign-up quiz, editable, with the
 * brief card beside it showing what the writer will read. One Save for the
 * whole page -- it's a profile, not a settings panel with a switch per row.
 */
export function BusinessProfile() {
  const brand = useQuery(api.brands.mine);
  if (brand === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (!brand || !brand.description) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-3xl">🏷️</p>
        <h1 className="mt-3 text-xl font-semibold">No business profile yet</h1>
        <p className="mt-1.5 text-sm text-muted">
          Take the two-minute quiz and every format can mention your business the way you&apos;d describe it.
        </p>
        <Link
          href="/onboarding?retake=1"
          className="mt-6 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Start the quiz
        </Link>
      </div>
    );
  }
  // Keyed on nothing that changes while editing: the form owns its state
  // from here, and a save doesn't reset what's on screen.
  return <Editor brand={brand} />;
}

function formOf(b: Brand): ProfileForm {
  return { ...EMPTY_PROFILE, ...b, logoAssetId: b.logoAssetId ?? null, logoUrl: b.logoUrl ?? null };
}

function Editor({ brand }: { brand: Brand }) {
  const save = useMutation(api.brands.saveProfile);
  const analyze = useAction(api.onboarding.analyze);
  const [saved, setSaved] = useState<ProfileForm>(() => formOf(brand));
  const [f, setF] = useState<ProfileForm>(saved);
  const [busy, setBusy] = useState<"save" | "refresh" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const dirty = useMemo(() => JSON.stringify(toSave(f)) !== JSON.stringify(toSave(saved)), [f, saved]);

  async function onSave() {
    setBusy("save");
    setMessage(null);
    try {
      await save(toSave(f) as never);
      setSaved(f);
      setMessage({ tone: "ok", text: "Saved. New content will use this straight away." });
    } catch (e) {
      setMessage({ tone: "error", text: cleanError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function refreshFromWebsite() {
    if (!f.website.trim()) return;
    setBusy("refresh");
    setMessage(null);
    try {
      const res = await analyze({ url: f.website });
      if (!res.ok) {
        setMessage({ tone: "error", text: res.message });
        return;
      }
      const d = res.draft;
      setF((p) => ({
        ...p,
        description: d.description || p.description,
        audience: d.audience || p.audience,
        problem: d.problem || p.problem,
        benefits: d.benefits || p.benefits,
        tone: d.tone || p.tone,
      }));
      setMessage({ tone: "ok", text: "Updated from your website — review it, then save." });
    } catch (e) {
      setMessage({ tone: "error", text: cleanError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pb-24">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Business</h1>
          <p className="text-sm text-muted">
            What every format writes from when <span className="font-medium text-foreground">Mention your business</span> is on.
          </p>
        </div>
        <Link href="/onboarding?retake=1" className="text-xs font-medium text-accent hover:underline">
          Retake the quiz
        </Link>
      </header>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Company name">
                <input className={inputClass} value={f.name} maxLength={TEXT_LIMITS.name} onChange={(e) => set("name", e.target.value)} />
              </Labelled>
              <Labelled label="Your name">
                <input className={inputClass} value={f.contactName} maxLength={TEXT_LIMITS.contactName} onChange={(e) => set("contactName", e.target.value)} />
              </Labelled>
            </div>
            <Labelled label="Website" optional>
              <div className="flex gap-2">
                <input className={inputClass} value={f.website} maxLength={TEXT_LIMITS.website} onChange={(e) => set("website", e.target.value)} placeholder="yourcompany.com" />
                <button
                  type="button"
                  onClick={refreshFromWebsite}
                  disabled={!f.website.trim() || busy !== null}
                  className="shrink-0 rounded-xl border border-line px-3 text-xs font-medium hover:border-accent disabled:opacity-40"
                  title="Re-read your website and redraft the answers below"
                >
                  {busy === "refresh" ? "Reading…" : "Refresh from site"}
                </button>
              </div>
            </Labelled>
            <Labelled label="Logo & colors" optional>
              <LogoField logoUrl={f.logoUrl} palette={f.palette} onChange={(patch) => setF((p) => ({ ...p, ...patch }))} />
            </Labelled>
          </Card>

          <Card title="What you do">
            <Labelled label="What do you sell or do?">
              <textarea className={inputClass} rows={2} value={f.description} maxLength={TEXT_LIMITS.description} onChange={(e) => set("description", e.target.value)} />
            </Labelled>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label="Who is it for?" optional>
                <textarea className={inputClass} rows={2} value={f.audience} maxLength={TEXT_LIMITS.audience} onChange={(e) => set("audience", e.target.value)} />
              </Labelled>
              <Labelled label="What problem does it solve?" optional>
                <textarea className={inputClass} rows={2} value={f.problem} maxLength={TEXT_LIMITS.problem} onChange={(e) => set("problem", e.target.value)} />
              </Labelled>
            </div>
            <Labelled label="Why do customers choose you?" optional>
              <textarea className={inputClass} rows={2} value={f.benefits} maxLength={TEXT_LIMITS.benefits} onChange={(e) => set("benefits", e.target.value)} />
            </Labelled>
            <Labelled label="Brand voice" optional>
              <ToneField value={f.tone} onChange={(v) => set("tone", v)} />
            </Labelled>
          </Card>

          <Card title="Content rules">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={f.testimonialGuard}
                onChange={(e) => set("testimonialGuard", e.target.checked)}
                className="mt-1 size-4 accent-accent"
              />
              <span>
                <span className="font-medium">Keep scripts clear of fake reviews</span>
                <span className="mt-1 block text-xs text-muted">
                  When a script mentions your business, the person on screen won&rsquo;t claim to have used
                  it or say what it did for them &mdash; they&rsquo;re often AI-generated, and the FTC treats an
                  invented customer experience as a fake review. They can still react to it, ask about it,
                  or say what it does. Turn off only if the speaker is a real customer describing their own
                  experience.
                </span>
              </span>
            </label>
          </Card>

          <Card title="About you">
            <Q label="Role">
              <Chips options={ROLES} value={f.role} onChange={(v) => set("role", v as string)} />
            </Q>
            <Q label="Team size">
              <Chips options={TEAM_SIZES} value={f.teamSize} onChange={(v) => set("teamSize", v as string)} />
            </Q>
            <Q label="Monthly revenue">
              <Chips options={REVENUE_BANDS} value={f.monthlyRevenue} onChange={(v) => set("monthlyRevenue", v as string)} />
            </Q>
          </Card>

          <Card title="Business type">
            <Q label="Who you sell to">
              <Chips options={BUSINESS_MODELS} value={f.businessModel} onChange={(v) => set("businessModel", v as string)} />
            </Q>
            <Q label="Category">
              <Chips options={CATEGORIES} value={f.categories} onChange={(v) => set("categories", v as string[])} multi />
            </Q>
          </Card>

          <Card title="Goals">
            <Q label="Where you're at">
              <Chips options={INTENTS} value={f.signupIntent} onChange={(v) => set("signupIntent", v as string)} />
            </Q>
            <Q label="What you want from it">
              <Chips options={GOALS} value={f.goals} onChange={(v) => set("goals", v as string[])} multi />
            </Q>
            <Q label="How you found us">
              <Chips options={SOURCES} value={f.heardFrom} onChange={(v) => set("heardFrom", v as string[])} multi />
            </Q>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-8">
          <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">Your brand brief</p>
          <BrandBrief f={f} />
        </aside>
      </div>

      {/* Save lives where the eye ends up, and only shouts when there's something to save. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-background/90 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <p className={`flex-1 text-xs ${message?.tone === "error" ? "text-accent" : "text-muted"}`}>
            {message?.text ?? (dirty ? "You have unsaved changes." : "All changes saved.")}
          </p>
          {dirty && (
            <button type="button" onClick={() => setF(saved)} disabled={busy !== null} className="text-xs text-muted hover:text-foreground">
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || busy !== null || !f.name.trim() || !f.description.trim()}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Q({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold">{label}</p>
      {children}
    </div>
  );
}
