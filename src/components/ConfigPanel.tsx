"use client";

import { UploadField } from "./UploadField";
import { MultiUploadField } from "./MultiUploadField";
import { TrendingClipField } from "./TrendingClipField";
import { BusinessProfileCard } from "./BusinessProfileCard";
import { AvatarField } from "./AvatarField";
import { AudioClipField } from "./AudioClipField";
import { VoicePreview } from "./VoicePreview";
import { AuthorisedBoundary } from "./AuthorisedBoundary";
import { convexConfigured } from "@/app/ConvexClientProvider";
import { fieldApplies } from "@/formats/types";
import type { AdvancedCard, AdvancedSection, Field, FormatDefinition } from "@/formats/types";

/**
 * The left-hand panel, rendered entirely from a format's `config` declaration.
 *
 * This is the payoff for the field types: nothing here knows what a carousel
 * or a claymation is. Add a format and its panel exists; add a field type and
 * every format that declares it gets the control.
 */
export function ConfigPanel({
  format,
  values,
  onChange,
}: {
  format: FormatDefinition;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  // A field whose `showWhen` doesn't hold isn't rendered at all -- switching
  // a stage off takes its settings with it rather than leaving controls on
  // screen that no longer reach anything. Advanced fields are decided per
  // card inside AdvancedOptions, because a card has to stay on screen (greyed,
  // saying what to turn on) even when its own switch is unavailable.
  const main = Object.entries(format.config).filter(
    ([, f]) => !f.advanced && fieldApplies(f, values),
  );
  const hasAdvanced = Object.values(format.config).some((f) => f.advanced);

  return (
    <div className="space-y-5">
      {main.map(([key, field]) => (
        <FieldControl
          key={key}
          id={key}
          field={field}
          value={values[key]}
          values={values}
          onChange={(v) => onChange(key, v)}
        />
      ))}

      {hasAdvanced && <AdvancedOptions format={format} values={values} onChange={onChange} />}
    </div>
  );
}

/**
 * The collapsed block the production line's settings live in.
 *
 * `<details>` rather than state: the open/closed bit is presentation, the
 * browser already animates it, and a panel that re-renders on every keystroke
 * shouldn't be able to collapse itself by losing that state.
 *
 * Inside, it is the old settings page: sections (Core pipeline, Optional
 * extras, Branding), each a run of cards, each card a stage with its model,
 * a line on what it does and -- when the stage can be left out -- a switch.
 * The format declares all of that (`advancedSections`); this only draws it.
 */
function AdvancedOptions({
  format,
  values,
  onChange,
}: {
  format: FormatDefinition;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const sections = advancedSectionsFor(format);

  return (
    <details className="group rounded-xl border border-line bg-surface-sub">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted hover:text-foreground">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Advanced options
      </summary>

      <div className="space-y-6 border-t border-line px-4 py-5">
        {sections.map((section) => (
          <section key={section.title || "more"}>
            {section.title && (
              <header className="mb-2.5">
                <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
                  {section.title}
                </h3>
                {section.blurb && (
                  <p className="mt-0.5 text-xs leading-snug text-muted">{section.blurb}</p>
                )}
              </header>
            )}
            <div className="space-y-3">
              {section.cards.map((card) => (
                <StageCard
                  key={card.title}
                  format={format}
                  card={card}
                  values={values}
                  onChange={onChange}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * The sections to draw. A format that declares `advancedSections` gets
 * exactly those; any `advanced` field naming a group no card claims is
 * collected into a trailing "More options" card rather than silently
 * dropped, so a typo in a `group` string shows up on screen instead of as a
 * setting that quietly never appears.
 *
 * A format that declares none at all gets one unheaded section, a card per
 * distinct `group`, in declaration order -- so marking a field `advanced` is
 * enough on its own to get it into the block.
 */
function advancedSectionsFor(format: FormatDefinition): AdvancedSection[] {
  const advanced = Object.values(format.config).filter((f) => f.advanced);

  if (!format.advancedSections?.length) {
    const titles = [...new Set(advanced.map((f) => f.group ?? "More options"))];
    return [{ title: "", blurb: "", cards: titles.map((title) => ({ title, blurb: "" })) }];
  }

  const claimed = new Set(format.advancedSections.flatMap((s) => s.cards.map((c) => c.title)));
  const stray = advanced.some((f) => !claimed.has(f.group ?? ""));
  return stray
    ? [
        ...format.advancedSections,
        { title: "", blurb: "", cards: [{ title: "More options", blurb: "" }] },
      ]
    : format.advancedSections;
}

/**
 * One stage. Its fields are whatever `advanced` fields name it as their
 * `group`, minus the toggle, which lives in the header instead.
 *
 * A stage whose switch is unavailable -- Subtitles with no voiceover to
 * transcribe -- stays on screen with the switch disabled and a line saying
 * what to turn on first. Hiding it would leave a user hunting for a setting
 * that exists; showing it greyed out says where it went.
 */
function StageCard({
  format,
  card,
  values,
  onChange,
}: {
  format: FormatDefinition;
  card: AdvancedCard;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const toggleField = card.toggle ? format.config[card.toggle] : undefined;
  const available = !toggleField || fieldApplies(toggleField, values);
  const on =
    !toggleField || (available && Boolean(values[card.toggle!] ?? (toggleField as { default?: unknown }).default));

  // What the switch is waiting on, named by the label of the field it needs.
  const needs =
    toggleField && !available && toggleField.showWhen
      ? format.config[toggleField.showWhen.field]?.label
      : undefined;

  const fields = Object.entries(format.config).filter(
    ([key, f]) =>
      f.advanced &&
      (f.group ?? "More options") === card.title &&
      key !== card.toggle &&
      fieldApplies(f, values),
  );

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h4 className="text-sm font-semibold">{card.title}</h4>

        {card.toggle && (
          <label className="flex items-center gap-2">
            <Switch
              checked={on}
              disabled={!available}
              label={card.title}
              onChange={(next) => onChange(card.toggle!, next)}
            />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
              {on ? "Enabled" : "Off"}
            </span>
          </label>
        )}

        {card.model && (
          <code
            title={card.model}
            className="ml-auto max-w-full truncate rounded bg-surface-sub px-1.5 py-0.5 font-mono text-[0.65rem] text-muted"
          >
            {card.model}
          </code>
        )}
      </div>

      {card.blurb && <p className="mt-1.5 text-xs leading-snug text-muted">{card.blurb}</p>}
      {needs && (
        <p className="mt-1.5 text-xs leading-snug text-warn">
          Turn on {needs} first — this works from its audio.
        </p>
      )}

      {on && fields.length > 0 && (
        <div className="mt-4 grid gap-x-4 gap-y-4 sm:grid-cols-2">
          {fields.map(([key, field]) => (
            <div key={key} className={spansRow(field) ? "sm:col-span-2" : undefined}>
              <FieldControl
                id={key}
                field={field}
                value={values[key]}
                values={values}
                onChange={(v) => onChange(key, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Text areas, uploads and pickers want the whole row; selects, sliders and colours pair up. */
function spansRow(field: Field): boolean {
  return (
    field.kind === "longText" ||
    field.kind === "image" ||
    field.kind === "images" ||
    field.kind === "video" ||
    field.kind === "audioClip"
  );
}

/** A real switch (role="switch"), like the old page's ENABLED toggle -- not a checkbox in disguise. */
function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-line-strong",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent";

function FieldControl({
  id,
  field,
  value,
  values,
  onChange,
}: {
  id: string;
  field: Field;
  value: unknown;
  /** Every field's value, for the few controls that depend on a sibling (a voice preview reads Delivery and Language). */
  values: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted"
      >
        {field.label}
        {field.optional && (
          <span className="font-normal normal-case tracking-normal opacity-70">
            optional
          </span>
        )}
      </label>

      <Control id={id} field={field} value={value} values={values} onChange={onChange} />

      {field.help && (
        <p className="mt-1 text-xs leading-snug text-muted">{field.help}</p>
      )}
      {field.generatedBy && !field.help && (
        <p className="mt-1 text-xs leading-snug text-muted">
          Leave blank and we&rsquo;ll write it for you.
        </p>
      )}
    </div>
  );
}

function Control({
  id,
  field,
  value,
  values,
  onChange,
}: {
  id: string;
  field: Field;
  value: unknown;
  values: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case "choice":
    case "captionStyle":
    case "mode": {
      const select = (
        <select
          id={id}
          className={inputClass}
          value={String(value ?? field.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );

      // A voice plays a sample from the deployment, so without one there is
      // nothing to call -- the plain select is the whole control.
      if (field.preview !== "voice" || !convexConfigured) return select;

      const voice = String(value ?? field.default ?? "");
      const stability = typeof values.voiceStability === "string" ? values.voiceStability : undefined;
      const language = typeof values.language === "string" ? values.language : undefined;
      return (
        <VoicePreview
          key={`${voice}|${stability ?? ""}|${language ?? ""}`}
          voice={voice}
          stability={stability}
          language={language}
        >
          {select}
        </VoicePreview>
      );
    }

    case "longText": {
      const text = String(value ?? "");
      return (
        <div>
          <textarea
            id={id}
            rows={field.rows ?? 4}
            aria-required={field.required || undefined}
            maxLength={field.maxLength}
            className={inputClass}
            placeholder={field.placeholder}
            value={text}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.maxLength && (
            <p className="mt-1 text-right font-mono text-[0.65rem] tabular-nums text-muted">
              {text.length} / {field.maxLength}
            </p>
          )}
        </div>
      );
    }

    case "shortText":
      return (
        <input
          id={id}
          type="text"
          aria-required={field.required || undefined}
          maxLength={field.maxLength}
          className={inputClass}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "seconds":
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            value={Number(value ?? field.default)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">
            {Number(value ?? field.default)}s
          </span>
        </div>
      );

    case "count":
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min}
            max={field.max}
            value={Number(value ?? field.default)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-14 shrink-0 text-right font-mono text-sm tabular-nums">
            {Number(value ?? field.default)}
          </span>
        </div>
      );

    case "toggle": {
      const on = Boolean(value ?? field.default);
      return (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              checked={on}
              onChange={(e) => onChange(e.target.checked)}
              className="size-4 accent-accent"
            />
            <span className="text-muted">{on ? "Yes" : "No"}</span>
          </label>
          {/* The toggle is only as good as what it mentions -- so the profile
              it reads sits right under it, and gets filled in there. */}
          {id === "mentionBusiness" && on && convexConfigured && (
            <AuthorisedBoundary>
              <BusinessProfileCard />
            </AuthorisedBoundary>
          )}
        </>
      );
    }

    case "language":
      return (
        <select
          id={id}
          className={inputClass}
          value={String(value ?? "en")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="en">English</option>
        </select>
      );

    case "color":
      // The native picker, which every major browser renders as a real colour
      // wheel. A brand colour has an exact value, so the hex sits beside it
      // rather than being hidden inside the swatch.
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="color"
            value={String(value ?? field.default ?? "#000000")}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-surface-sub p-1"
          />
          <span className="font-mono text-sm uppercase tabular-nums text-muted">
            {String(value ?? field.default ?? "#000000")}
          </span>
        </div>
      );

    case "images":
      return convexConfigured ? (
        <AuthorisedBoundary>
          <MultiUploadField value={value} onChange={onChange} maxItems={field.maxItems} />
        </AuthorisedBoundary>
      ) : (
        <Placeholder kind={field.kind} />
      );

    case "image":
    case "video":
      // Needs a deployment to upload to; without one the control would fail on
      // its first click, so say why instead.
      return convexConfigured ? (
        <UploadField
          accept={
            field.kind === "video" ? (field.videoOnly ? "videoOnly" : "video") : "image"
          }
          value={value}
          onChange={onChange}
        />
      ) : (
        <Placeholder kind={field.kind} />
      );

    case "trendingClip":
      return convexConfigured ? (
        <TrendingClipField value={value} onChange={onChange} />
      ) : (
        <Placeholder kind={field.kind} />
      );

    case "avatar":
      return convexConfigured ? (
        <AuthorisedBoundary>
          <AvatarField
            value={value}
            onChange={onChange}
            options={{
              label: field.label,
              emptyLabel: field.emptyLabel,
              casting: field.casting,
              videos: field.videos,
            }}
          />
        </AuthorisedBoundary>
      ) : (
        <Placeholder kind={field.kind} />
      );

    case "audioClip":
      return convexConfigured ? (
        <AuthorisedBoundary>
          <AudioClipField value={value} onChange={onChange} emptyLabel={field.emptyLabel} label={field.label} />
        </AuthorisedBoundary>
      ) : (
        <Placeholder kind={field.kind} />
      );

    default:
      return <Placeholder kind={(field as Field).kind} />;
  }
}

const PLACEHOLDER_NOTE: Record<string, string> = {
  image: "Upload — connect Convex to enable",
  images: "Uploads — connect Convex to enable",
  video: "Upload — connect Convex to enable",
  color: "Colour picker",
  avatar: "Roster picker — connect Convex to enable",
  trendingClip: "Clip library — connect Convex to enable",
};

function Placeholder({ kind }: { kind: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
      {PLACEHOLDER_NOTE[kind] ?? kind}
    </div>
  );
}
