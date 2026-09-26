"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { TONES } from "../../../convex/lib/businessQuiz";

/**
 * The business profile as the browser edits it -- shared by the sign-up quiz
 * (/onboarding) and the Business page, so both edit the same shape with the
 * same controls and send it through the same `brands.saveProfile`.
 */
export interface ProfileForm {
  contactName: string;
  name: string;
  website: string;
  description: string;
  audience: string;
  problem: string;
  benefits: string;
  tone: string;
  palette: string[];
  logoAssetId: string | null;
  logoUrl: string | null;
  businessModel: string;
  categories: string[];
  role: string;
  teamSize: string;
  monthlyRevenue: string;
  signupIntent: string;
  goals: string[];
  heardFrom: string[];
  /** Keep scripts from reading as a real customer's review -- see convex/lib/businessContext.ts. */
  testimonialGuard: boolean;
}

export const EMPTY_PROFILE: ProfileForm = {
  contactName: "",
  name: "",
  website: "",
  description: "",
  audience: "",
  problem: "",
  benefits: "",
  tone: "",
  palette: [],
  logoAssetId: null,
  logoUrl: null,
  businessModel: "",
  categories: [],
  role: "",
  teamSize: "",
  monthlyRevenue: "",
  signupIntent: "",
  goals: [],
  heardFrom: [],
  testimonialGuard: true,
};

/**
 * Everything `saveProfile` accepts, from the form -- the logo URL is
 * display-only. Only the form's own keys: the Business page's form is built
 * from `brands.mine`, which also carries `onboarded` and `quizStep`, and an
 * argument `saveProfile` doesn't declare makes Convex reject the whole save.
 */
export function toSave(f: Partial<ProfileForm>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(EMPTY_PROFILE) as (keyof ProfileForm)[]) {
    if (key !== "logoUrl" && f[key] !== undefined) out[key] = f[key];
  }
  return out as Omit<Partial<ProfileForm>, "logoUrl">;
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /Uncaught Error: ([^\n]+)/.exec(msg)?.[1] ?? msg;
}

// ---------------------------------------------------------------- inputs

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/10";

export function Labelled({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold text-foreground">
        {label}
        {optional && <span className="font-normal text-muted">optional</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Selectable chips: one answer, or several. */
export function Chips({
  options,
  value,
  onChange,
  multi = false,
  columns,
  max,
}: {
  options: readonly string[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  multi?: boolean;
  columns?: 2 | 3 | 4;
  max?: number;
}) {
  const chosen = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const grid =
    columns === 2 ? "grid grid-cols-2 gap-2" : columns === 4 ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : columns === 3 ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "flex flex-wrap gap-2";
  return (
    <div className={grid} role={multi ? "group" : "radiogroup"}>
      {options.map((o) => {
        const on = chosen.has(o);
        const full = multi && max !== undefined && !on && chosen.size >= max;
        return (
          <button
            key={o}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            disabled={full}
            onClick={() => {
              if (!multi) return onChange(o);
              const next = new Set(chosen);
              if (on) next.delete(o);
              else next.add(o);
              onChange(options.filter((x) => next.has(x)));
            }}
            className={[
              "rounded-xl border px-3.5 py-2.5 text-sm transition",
              on
                ? "border-accent bg-accent text-white shadow-[0_6px_16px_-8px_var(--accent)]"
                : "border-line bg-surface text-foreground hover:border-accent/60 hover:bg-accent-soft",
              full ? "cursor-not-allowed opacity-40" : "",
            ].join(" ")}
          >
            {multi && (
              <span aria-hidden className="mr-1.5 inline-block w-3 text-center">
                {on ? "✓" : "+"}
              </span>
            )}
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Brand voice: up to three quick picks plus anything typed. Stored as one
 * comma-separated string, which is how every prompt reads it anyway.
 */
export function ToneField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = parts.filter((p) => (TONES as readonly string[]).includes(p));
  const custom = parts.filter((p) => !(TONES as readonly string[]).includes(p)).join(", ");
  const join = (chips: string[], extra: string) =>
    [...chips, ...extra.split(",").map((s) => s.trim()).filter(Boolean)].join(", ");
  // What's typed stays as typed while the box has focus -- re-deriving it
  // from the stored string would swallow a comma the moment it was typed.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      <Chips
        options={TONES}
        value={picked}
        multi
        max={3}
        onChange={(next) => onChange(join(next as string[], custom))}
      />
      <input
        className={inputClass}
        value={draft ?? custom}
        maxLength={80}
        placeholder="Or in your own words, e.g. “like a friend who happens to be an accountant”"
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(join(picked, e.target.value));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- logo

/**
 * Upload a logo, and read the brand's colours out of it while we have the
 * pixels. The palette lands in the studio's colour swatches, so text can be
 * set in the brand's own colours without anyone typing a hex code.
 */
export function LogoField({
  logoUrl,
  palette,
  onChange,
}: {
  logoUrl: string | null;
  palette: string[];
  onChange: (patch: Partial<Pick<ProfileForm, "logoAssetId" | "logoUrl" | "palette">>) => void;
}) {
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Use a PNG, JPEG or WebP.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const local = URL.createObjectURL(file);
      const { width, height, colours } = await readImage(local);
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const assetId = await attach({ storageId: storageId as never, mimeType: file.type, bytes: file.size, width, height });
      onChange({ logoAssetId: assetId, logoUrl: local, palette: colours.length ? colours : palette });
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-line-strong bg-surface-sub transition hover:border-accent"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="size-full object-contain p-2" />
        ) : (
          <span className="px-2 text-center text-xs text-muted group-hover:text-foreground">
            {busy ? "Uploading…" : "+ Logo"}
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-muted">
          {logoUrl
            ? "We picked these colors from your logo — they'll show up as swatches when you style text."
            : "Optional. We'll pull your brand colors from it."}
        </p>
        {palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                title={`Remove ${c}`}
                onClick={() => onChange({ palette: palette.filter((x) => x !== c) })}
                className="group relative size-7 rounded-full border border-black/10 shadow-sm"
                style={{ background: c }}
              >
                <span className="absolute inset-0 hidden place-items-center rounded-full bg-black/40 text-xs text-white group-hover:grid">
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={() => inputRef.current?.click()} className="font-medium text-accent hover:underline">
            {logoUrl ? "Replace" : "Upload"}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => onChange({ logoAssetId: null, logoUrl: null, palette: [] })}
              className="text-muted hover:text-foreground"
            >
              Remove
            </button>
          )}
        </div>
        {error && <p className="text-xs text-accent">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/**
 * Size, and up to four distinct colours: pixels are bucketed coarsely, the
 * busiest buckets win, near-white and near-transparent pixels (a logo's
 * background) are ignored, and a colour too close to one already picked is
 * skipped so the palette isn't four shades of the same red.
 */
async function readImage(src: string): Promise<{ width?: number; height?: number; colours: string[] }> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
  if (!img) return { colours: [] };
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return { width: img.naturalWidth, height: img.naturalHeight, colours: [] };
  g.drawImage(img, 0, 0, size, size);
  const { data } = g.getImageData(0, 0, size, size);

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, gr, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 160) continue;
    if (r > 235 && gr > 235 && b > 235) continue;
    const key = ((r >> 4) << 8) | ((gr >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += gr;
    e.b += b;
    buckets.set(key, e);
  }
  const picked: [number, number, number][] = [];
  for (const e of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    if (e.n < 6) break;
    const c: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round) as [number, number, number];
    if (picked.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 70)) continue;
    picked.push(c);
    if (picked.length === 4) break;
  }
  const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return { width: img.naturalWidth, height: img.naturalHeight, colours: picked.map(hex) };
}

// ---------------------------------------------------------------- the brief

/**
 * The profile as the writer will see it, drawn as a card. The quiz shows it
 * filling in beside the questions; the last step and the Business page show
 * it finished.
 */
export function BrandBrief({ f, live = false }: { f: ProfileForm; live?: boolean }) {
  const initial = (f.name || "?").slice(0, 1).toUpperCase();
  const posting = [f.contactName, f.role].filter(Boolean).join(" · ");
  const accent = f.palette[0] ?? "var(--accent)";
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_24px_60px_-30px_rgba(33,28,38,0.35)]">
      <div className="h-16" style={{ background: `linear-gradient(120deg, ${accent}, ${f.palette[1] ?? "var(--accent-soft)"})` }} />
      <div className="-mt-9 px-5 pb-5">
        <div className="flex items-end gap-3">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-surface bg-surface-sub text-xl font-semibold shadow-sm">
            {f.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.logoUrl} alt="" className="size-full object-contain p-1" />
            ) : (
              <span style={{ color: accent }}>{initial}</span>
            )}
          </div>
          <div className="min-w-0 pb-1">
            <p className="truncate text-base font-semibold">{f.name || <Ghost w="w-32" />}</p>
            <p className="truncate text-xs text-muted">{posting || (live ? <Ghost w="w-24" /> : "")}</p>
          </div>
          {live && (
            <span className="mb-2 ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Live
            </span>
          )}
        </div>

        {f.palette.length > 0 && (
          <div className="mt-3 flex gap-1.5">
            {f.palette.map((c) => (
              <span key={c} className="h-2 flex-1 rounded-full" style={{ background: c }} />
            ))}
          </div>
        )}

        <dl className="mt-4 space-y-3 text-sm">
          <BriefLine label="What you do" value={f.description} />
          <BriefLine label="For" value={f.audience} />
          <BriefLine label="Solves" value={f.problem} />
          <BriefLine label="Why you" value={f.benefits} />
        </dl>

        {(f.tone || f.businessModel || f.categories.length > 0) && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {f.tone
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-full bg-accent-soft px-2.5 py-1 text-[0.7rem] font-medium text-accent">
                  {t}
                </span>
              ))}
            {[f.businessModel, ...f.categories].filter(Boolean).map((c) => (
              <span key={c} className="rounded-full border border-line px-2.5 py-1 text-[0.7rem] text-muted">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BriefLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-0.5 leading-snug">{value ? <span className="line-clamp-3">{value}</span> : <Ghost w="w-full" />}</dd>
    </div>
  );
}

function Ghost({ w }: { w: string }) {
  return <span className={`mt-1 inline-block h-2.5 ${w} rounded-full bg-surface-sub`} />;
}
