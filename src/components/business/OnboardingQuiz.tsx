"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import {
  BUSINESS_MODELS,
  CATEGORIES,
  GOALS,
  INTENTS,
  QUIZ_STEPS,
  REVENUE_BANDS,
  ROLES,
  SOURCES,
  TEAM_SIZES,
  TEXT_LIMITS,
  type QuizStep,
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

/** The questions, not counting the finished card at the end. */
const QUESTION_STEPS = QUIZ_STEPS.filter((s) => s !== "done");

/**
 * The sign-up quiz: seven short screens that become the business profile
 * every "Mention your business" prompt writes from.
 *
 * Each Continue saves that screen's answers and the step reached, so closing
 * the tab halfway resumes at the same question. A brief card beside the
 * questions fills in as they're answered -- the point of the quiz is that
 * card, so it is on screen the whole way through rather than revealed at the
 * end.
 */
export function OnboardingQuiz() {
  const brand = useQuery(api.brands.mine);
  if (brand === undefined) {
    return (
      <Frame>
        <p className="py-24 text-center text-sm text-muted">
          Getting things ready…
        </p>
      </Frame>
    );
  }
  return <Quiz brand={brand} />;
}

function fromBrand(b: Brand | null): ProfileForm {
  if (!b) return EMPTY_PROFILE;
  return {
    ...EMPTY_PROFILE,
    ...b,
    logoAssetId: b.logoAssetId ?? null,
    logoUrl: b.logoUrl ?? null,
  };
}

function Quiz({ brand }: { brand: Brand | null }) {
  const router = useRouter();
  const save = useMutation(api.brands.saveProfile);
  const complete = useMutation(api.brands.completeOnboarding);
  const skip = useMutation(api.brands.skipOnboarding);
  const analyze = useAction(api.onboarding.analyze);

  const [params] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams(),
  );
  const retake = params.has("retake");
  // Opened in a new tab from a video's "Mention your business" card: that tab
  // is still waiting, and its card updates by itself once this finishes.
  const fromEditor = params.get("from") === "editor";
  const [f, setF] = useState<ProfileForm>(() => fromBrand(brand));
  const [step, setStep] = useState<QuizStep>(() => {
    if (retake || !brand || brand.onboarded) return "basics";
    return (QUIZ_STEPS as readonly string[]).includes(brand.quizStep)
      ? (brand.quizStep as QuizStep)
      : "basics";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysed, setAnalysed] = useState(false);

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const index = QUIZ_STEPS.indexOf(step);

  /** Saves this screen's answers with the step it leads to, then moves there. */
  async function advance(fields: (keyof ProfileForm)[], to: QuizStep) {
    setBusy(true);
    setError(null);
    try {
      const patch = Object.fromEntries(
        fields.map((k) => [k, f[k]]),
      ) as Partial<ProfileForm>;
      await save({ ...toSave(patch), quizStep: to } as never);
      if (to === "done") await complete();
      setStep(to);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setError(null);
    setStep(QUIZ_STEPS[Math.max(0, index - 1)]);
  }

  async function onSkip() {
    if (retake || brand?.onboarded) return router.push("/business");
    setBusy(true);
    try {
      await skip();
      router.replace("/");
    } catch (e) {
      setError(cleanError(e));
      setBusy(false);
    }
  }

  const questionNo =
    QUESTION_STEPS.indexOf(step as (typeof QUESTION_STEPS)[number]) + 1;

  return (
    <Frame
      progress={step === "done" ? 1 : (questionNo - 1) / QUESTION_STEPS.length}
      right={
        step !== "done" && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-xs text-muted hover:text-foreground"
          >
            {retake || brand?.onboarded ? "Exit" : "Skip for now"}
          </button>
        )
      }
    >
      {step === "done" ? (
        <Done f={f} fromEditor={fromEditor} />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div key={step} className="animate-[quiz-in_320ms_ease-out]">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-accent">
              Step {questionNo} of {QUESTION_STEPS.length}
            </p>

            {step === "basics" && (
              <Screen
                title="Let's get to know your business"
                subtitle="Everything here shapes the content we write for you. You can change any of it later."
                canContinue={Boolean(f.contactName.trim() && f.name.trim())}
                busy={busy}
                onContinue={() =>
                  advance(
                    ["contactName", "name", "logoAssetId", "palette"],
                    "source",
                  )
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labelled label="Your name">
                    <input
                      autoFocus
                      className={inputClass}
                      value={f.contactName}
                      maxLength={TEXT_LIMITS.contactName}
                      onChange={(e) => set("contactName", e.target.value)}
                      placeholder="Alex"
                    />
                  </Labelled>
                  <Labelled label="Company name">
                    <input
                      className={inputClass}
                      value={f.name}
                      maxLength={TEXT_LIMITS.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Acme Studio"
                    />
                  </Labelled>
                </div>
                <Labelled label="Logo" optional>
                  <LogoField
                    logoUrl={f.logoUrl}
                    palette={f.palette}
                    onChange={(patch) => setF((p) => ({ ...p, ...patch }))}
                  />
                </Labelled>
              </Screen>
            )}

            {step === "source" && (
              <SourceStep
                f={f}
                set={set}
                busy={busy}
                onBack={back}
                onManual={() => {
                  setAnalysed(false);
                  void advance(["website"], "understood");
                }}
                onAnalyse={async (input) => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await analyze(input);
                    if (!res.ok) return res;
                    const d = res.draft;
                    setF((p) => ({
                      ...p,
                      name: p.name || d.name,
                      description: d.description || p.description,
                      audience: d.audience || p.audience,
                      problem: d.problem || p.problem,
                      benefits: d.benefits || p.benefits,
                      tone: d.tone || p.tone,
                      businessModel: p.businessModel || d.businessModel,
                      categories: p.categories.length
                        ? p.categories
                        : d.categories,
                    }));
                    setAnalysed(true);
                    await save({ website: f.website, quizStep: "understood" });
                    setStep("understood");
                    return null;
                  } catch (e) {
                    setError(cleanError(e));
                    return null;
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}

            {step === "understood" && (
              <Screen
                title={
                  analysed
                    ? "Here's what we picked up"
                    : "Tell us about your business"
                }
                subtitle={
                  analysed
                    ? "Straight from your website. Fix anything that's off — this is what we'll write from."
                    : "A sentence each is plenty. The more specific, the less generic your content."
                }
                canContinue={Boolean(f.description.trim())}
                busy={busy}
                onBack={back}
                onContinue={() =>
                  advance(
                    ["description", "audience", "problem", "benefits", "tone"],
                    "you",
                  )
                }
              >
                <Labelled label="What do you sell or do?">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={f.description}
                    maxLength={TEXT_LIMITS.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Monthly bookkeeping for freelancers, done in an app — no spreadsheets."
                  />
                </Labelled>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labelled label="Who is it for?" optional>
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={f.audience}
                      maxLength={TEXT_LIMITS.audience}
                      onChange={(e) => set("audience", e.target.value)}
                      placeholder="Freelancers and solo founders"
                    />
                  </Labelled>
                  <Labelled label="What problem does it solve?" optional>
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={f.problem}
                      maxLength={TEXT_LIMITS.problem}
                      onChange={(e) => set("problem", e.target.value)}
                      placeholder="Tax season panic and lost receipts"
                    />
                  </Labelled>
                </div>
                <Labelled label="Why do customers choose you?" optional>
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={f.benefits}
                    maxLength={TEXT_LIMITS.benefits}
                    onChange={(e) => set("benefits", e.target.value)}
                    placeholder="Set up in 10 minutes, a real accountant on chat, flat monthly price"
                  />
                </Labelled>
                <Labelled
                  label="How does your brand sound?"
                  hint="Pick up to three, or describe it."
                >
                  <ToneField value={f.tone} onChange={(v) => set("tone", v)} />
                </Labelled>
              </Screen>
            )}

            {step === "you" && (
              <Screen
                title={`Nice to meet you${f.contactName ? `, ${f.contactName.split(" ")[0]}` : ""}`}
                subtitle="Content in the first person should sound like the person posting it."
                canContinue={Boolean(f.role)}
                busy={busy}
                onBack={back}
                onContinue={() =>
                  advance(["role", "teamSize", "monthlyRevenue"], "business")
                }
              >
                <Question label="What describes you best?">
                  <Chips
                    options={ROLES}
                    value={f.role}
                    onChange={(v) => set("role", v as string)}
                    columns={3}
                  />
                </Question>
                <Question label="How big is the team?">
                  <Chips
                    options={TEAM_SIZES}
                    value={f.teamSize}
                    onChange={(v) => set("teamSize", v as string)}
                    columns={3}
                  />
                </Question>
                <Question
                  label="Monthly revenue"
                  hint="Only used to pitch advice at the right stage. Never shown anywhere."
                >
                  <Chips
                    options={REVENUE_BANDS}
                    value={f.monthlyRevenue}
                    onChange={(v) => set("monthlyRevenue", v as string)}
                    columns={3}
                  />
                </Question>
              </Screen>
            )}

            {step === "business" && (
              <Screen
                title={`What kind of business is ${f.name || "it"}?`}
                subtitle={
                  analysed && f.categories.length
                    ? "We guessed from your website — adjust if we got it wrong."
                    : "So examples and scenarios fit your customers."
                }
                canContinue={Boolean(f.businessModel && f.categories.length)}
                busy={busy}
                onBack={back}
                onContinue={() =>
                  advance(["businessModel", "categories"], "goals")
                }
              >
                <Question label="Who do you sell to?">
                  <Chips
                    options={BUSINESS_MODELS}
                    value={f.businessModel}
                    onChange={(v) => set("businessModel", v as string)}
                    columns={3}
                  />
                </Question>
                <Question label="Category" hint="Select all that apply.">
                  <Chips
                    options={CATEGORIES}
                    value={f.categories}
                    onChange={(v) => set("categories", v as string[])}
                    multi
                  />
                </Question>
              </Screen>
            )}

            {step === "goals" && (
              <Screen
                title="What brings you here?"
                subtitle="We'll point you at the formats that fit."
                canContinue={Boolean(f.signupIntent)}
                busy={busy}
                onBack={back}
                onContinue={() => advance(["signupIntent", "goals"], "heard")}
              >
                <Question label="Where are you at?">
                  <Chips
                    options={INTENTS}
                    value={f.signupIntent}
                    onChange={(v) => set("signupIntent", v as string)}
                    columns={3}
                  />
                </Question>
                <Question
                  label="What do you want from it?"
                  hint="Select all that apply."
                >
                  <Chips
                    options={GOALS}
                    value={f.goals}
                    onChange={(v) => set("goals", v as string[])}
                    multi
                    columns={3}
                  />
                </Question>
              </Screen>
            )}

            {step === "heard" && (
              <Screen
                title="Last one — how did you hear about us?"
                subtitle="Select all that apply."
                canContinue
                continueLabel="Finish"
                busy={busy}
                onBack={back}
                onContinue={() => advance(["heardFrom"], "done")}
              >
                <Chips
                  options={SOURCES}
                  value={f.heardFrom}
                  onChange={(v) => set("heardFrom", v as string[])}
                  multi
                  columns={4}
                />
              </Screen>
            )}

            {error && (
              <p className="mt-4 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-sm text-accent">
                {error}
              </p>
            )}
          </div>

          <aside className="hidden lg:sticky lg:top-24 lg:block">
            <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
              Your brand brief
            </p>
            <BrandBrief f={f} live />
            <p className="mt-3 text-xs leading-snug text-muted">
              Whenever you switch on{" "}
              <span className="font-medium text-foreground">
                Mention your business
              </span>
              , this is what we write from.
            </p>
          </aside>
        </div>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- source step

const DESCRIBE_TEMPLATE =
  "What we sell:\nWho it's for:\nThe problem we solve:\nWhy people choose us:\nHow we sound:";

const READING_PHASES = [
  "Reading your homepage",
  "Working out what you sell",
  "Finding who it's for",
  "Picking up your voice",
];

function SourceStep({
  f,
  set,
  busy,
  onBack,
  onManual,
  onAnalyse,
}: {
  f: ProfileForm;
  set: <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => void;
  busy: boolean;
  onBack: () => void;
  onManual: () => void;
  onAnalyse: (
    input: { url: string } | { text: string },
  ) => Promise<{ ok: false; reason: string; message: string } | null>;
}) {
  const [mode, setMode] = useState<"website" | "describe">("website");
  const [text, setText] = useState(DESCRIBE_TEMPLATE);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(
      () => setPhase((p) => Math.min(p + 1, READING_PHASES.length - 1)),
      1600,
    );
    return () => {
      clearInterval(t);
      setPhase(0);
    };
  }, [busy]);

  async function run() {
    setNotice(null);
    const failed = await onAnalyse(
      mode === "website" ? { url: f.website } : { text },
    );
    if (failed) {
      setNotice(failed.message);
      if (mode === "website" && failed.reason !== "invalid")
        setMode("describe");
    }
  }

  const filledTemplate =
    text.replace(/^[^:\n]+:\s*$/gm, "").trim().length >= 20;

  return (
    <Screen
      title="Show us your business"
      subtitle="We'll read your website and draft your profile for you. You check it next."
      busy={busy}
      canContinue={
        mode === "website" ? f.website.trim().length > 3 : filledTemplate
      }
      continueLabel={mode === "website" ? "Analyze website" : "Continue"}
      onBack={onBack}
      onContinue={run}
      footer={
        <button
          type="button"
          onClick={onManual}
          disabled={busy}
          className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          I&apos;ll fill it in myself
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-sub p-1">
        {(
          [
            ["website", "Website"],
            ["describe", "Describe it instead"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={[
              "rounded-lg py-2 text-sm transition",
              mode === m
                ? "bg-surface font-semibold text-foreground shadow-sm"
                : "text-muted hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm">
          <span aria-hidden className="mt-0.5 text-warn">
            ⚠
          </span>
          <div>
            <p className="font-semibold text-foreground">
              We couldn&apos;t read your website
            </p>
            <p className="mt-0.5 text-muted">
              {notice} Paste your homepage text below, or describe the business
              in your own words — we&apos;ll handle the rest.
            </p>
          </div>
        </div>
      )}

      {busy ? (
        <ul className="space-y-2.5 rounded-xl border border-line bg-surface p-4">
          {(mode === "website" ? READING_PHASES : READING_PHASES.slice(1)).map(
            (p, i) => {
              const at = mode === "website" ? phase : Math.max(0, phase - 1);
              const state = i < at ? "done" : i === at ? "now" : "next";
              return (
                <li
                  key={p}
                  className={`flex items-center gap-2.5 text-sm ${state === "next" ? "text-muted" : ""}`}
                >
                  <span
                    className={[
                      "grid size-5 place-items-center rounded-full text-[0.6rem]",
                      state === "done"
                        ? "bg-ok text-white"
                        : state === "now"
                          ? "border-2 border-accent border-t-transparent animate-spin"
                          : "border border-line",
                    ].join(" ")}
                  >
                    {state === "done" ? "✓" : ""}
                  </span>
                  {p}
                  {state === "now" && "…"}
                </li>
              );
            },
          )}
        </ul>
      ) : mode === "website" ? (
        <Labelled label="Company website">
          <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
            <span className="pl-3.5 text-sm text-muted">https://</span>
            <input
              autoFocus
              className="w-full bg-transparent px-1 py-2.5 text-sm outline-none"
              value={f.website.replace(/^https?:\/\//i, "")}
              maxLength={TEXT_LIMITS.website}
              onChange={(e) => set("website", e.target.value.trim())}
              placeholder="www.yourcompany.com"
              inputMode="url"
            />
          </div>
        </Labelled>
      ) : (
        <Labelled
          label="Your business, in your words"
          hint={filledTemplate ? undefined : "A couple of lines is enough."}
        >
          <textarea
            autoFocus
            className={`${inputClass} font-mono text-[0.8rem] leading-relaxed`}
            rows={7}
            value={text}
            maxLength={8000}
            onChange={(e) => setText(e.target.value)}
          />
        </Labelled>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------- the end

function Done({ f, fromEditor }: { f: ProfileForm; fromEditor: boolean }) {
  return (
    <div className="mx-auto max-w-3xl animate-[quiz-in_420ms_ease-out] text-center">
      <p className="text-4xl">🎉</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        {f.name ? `${f.name} is all set` : "You're all set"}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        Switch on{" "}
        <span className="font-medium text-foreground">
          Mention your business
        </span>{" "}
        in any format and we&apos;ll write from this brief. Change it anytime on
        the Business page.
      </p>
      <div className="mx-auto mt-8 max-w-sm text-left">
        <BrandBrief f={f} />
      </div>
      {fromEditor ? (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_var(--accent)] hover:opacity-90"
          >
            Back to my video
          </button>
          <p className="text-xs text-muted">
            Your video&apos;s tab has already picked this up. If this tab
            doesn&apos;t close, just switch back.
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/new/wall-of-text"
            className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_var(--accent)] hover:opacity-90"
          >
            Make my first Wall of Text →
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-line px-5 py-3 text-sm font-medium hover:border-accent"
          >
            Browse all formats
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- layout

function Frame({
  children,
  progress,
  right,
}: {
  children: React.ReactNode;
  progress?: number;
  right?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_500px_at_85%_-10%,var(--accent-soft),transparent),radial-gradient(900px_400px_at_-10%_110%,var(--accent-soft),transparent)]">
      <header className="sticky top-0 z-10 border-b border-line/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
          <span className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-accent text-sm font-semibold text-white">
              F
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">
              Format Engine
            </span>
          </span>
          <div className="mx-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-sub">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
          <div className="w-24 shrink-0 text-right">{right}</div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:py-14">{children}</main>
    </div>
  );
}

function Screen({
  title,
  subtitle,
  children,
  canContinue,
  continueLabel = "Continue",
  busy,
  onBack,
  onContinue,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  canContinue: boolean;
  continueLabel?: string;
  busy: boolean;
  onBack?: () => void;
  onContinue: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue && !busy) onContinue();
      }}
    >
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-1.5 max-w-lg text-sm text-muted">{subtitle}</p>
      <div className="mt-7 space-y-5 rounded-3xl border border-line bg-surface/90 p-5 shadow-[0_24px_60px_-40px_rgba(33,28,38,0.4)] sm:p-7">
        {children}
      </div>
      <div className="mt-6 flex items-center gap-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="text-sm text-muted hover:text-foreground"
          >
            ← Back
          </button>
        )}
        {footer}
        <button
          type="submit"
          disabled={!canContinue || busy}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_var(--accent)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {busy ? "One moment…" : continueLabel}
          {!busy && <span aria-hidden>→</span>}
        </button>
      </div>
    </form>
  );
}

function Question({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      {hint && <p className="mb-2.5 mt-0.5 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2.5"}>{children}</div>
    </div>
  );
}
