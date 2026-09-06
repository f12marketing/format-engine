"use client";

import { UploadField } from "./UploadField";
import { convexConfigured } from "@/app/ConvexClientProvider";
import type { Field, FormatDefinition } from "@/formats/types";

/**
 * The left-hand panel, rendered entirely from a format's `config` declaration.
 *
 * This is the payoff for the thirteen field types: nothing here knows what a
 * carousel or a claymation is. Add a format and its panel exists; add a field
 * type and every format that declares it gets the control.
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
  return (
    <div className="space-y-5">
      {Object.entries(format.config).map(([key, field]) => (
        <FieldControl
          key={key}
          id={key}
          field={field}
          value={values[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent";

function FieldControl({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: Field;
  value: unknown;
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

      <Control id={id} field={field} value={value} onChange={onChange} />

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
  onChange,
}: {
  id: string;
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.kind) {
    case "choice":
    case "captionStyle":
    case "mode":
      return (
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

    case "longText":
      return (
        <textarea
          id={id}
          rows={4}
          className={inputClass}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "shortText":
      return (
        <input
          id={id}
          type="text"
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

    case "toggle":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value ?? field.default)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-accent"
          />
          <span className="text-muted">
            {Boolean(value ?? field.default) ? "Yes" : "No"}
          </span>
        </label>
      );

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

    case "image":
    case "video":
      // Needs a deployment to upload to; without one the control would fail on
      // its first click, so say why instead.
      return convexConfigured ? (
        <UploadField
          accept={field.kind === "video" ? "video" : "image"}
          value={value}
          onChange={onChange}
        />
      ) : (
        <Placeholder kind={field.kind} />
      );

    // The avatar roster and the clip library need tables that arrive with
    // their own phases. The placeholder names which one, so the gap is legible
    // rather than blank.
    case "avatar":
    case "trendingClip":
      return <Placeholder kind={field.kind} />;

    default:
      return <Placeholder kind={(field as Field).kind} />;
  }
}

const PLACEHOLDER_NOTE: Record<string, string> = {
  image: "Upload — connect Convex to enable",
  video: "Upload — connect Convex to enable",
  avatar: "Roster picker — P10, Phase 4",
  trendingClip: "Clip library — P9, Phase 3",
};

function Placeholder({ kind }: { kind: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
      {PLACEHOLDER_NOTE[kind] ?? kind}
    </div>
  );
}
