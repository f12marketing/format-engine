/**
 * The status pill, in one place.
 *
 * Jobs, projects, influencers and now social posts all render the same shape
 * with the same three-colour vocabulary -- green for settled, amber for
 * in-flight, accent for needs-you. Keeping one map means a new status can't
 * pick up a different colour in one list than it has in another.
 */
const STATUS_CLASS: Record<string, string> = {
  // settled
  done: "text-ok border-ok",
  ready: "text-ok border-ok",
  published: "text-ok border-ok",
  // in flight
  running: "text-warn border-warn",
  training: "text-warn border-warn",
  generating: "text-warn border-warn",
  publishing: "text-warn border-warn",
  scheduled: "text-warn border-warn",
  awaiting_approval: "text-warn border-warn",
  needs_review: "text-warn border-warn",
  // needs you
  failed: "text-accent border-accent",
  partial: "text-accent border-accent",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide ${
        STATUS_CLASS[status] ?? "text-muted border-line"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/**
 * The filter row above a list. Same visual family as the pill, but these are
 * buttons that own a selection rather than labels that report state.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-full border px-3 py-1 text-xs transition",
              active
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line text-muted hover:border-line-strong hover:text-foreground",
            ].join(" ")}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="ml-1.5 font-mono text-[0.65rem] opacity-70">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
