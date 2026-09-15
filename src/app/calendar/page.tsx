"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { StatusPill } from "@/components/StatusPill";
import { PLATFORMS, type Platform } from "@/lib/socialPlatforms";

/**
 * The month view over `socialPosts`.
 *
 * Native `Date` and `Intl`, no date library -- the house call made when this
 * feature started (see the Zernio plan), and a month grid is simple enough
 * arithmetic that a dependency would buy nothing.
 *
 * `scheduledFor` is stored as whatever `new Date(localString).getTime()`
 * produced when the post was composed, in the browser's timezone at that
 * moment. Reading it back with plain `Date` accessors in the same browser
 * reproduces the same wall-clock day and time -- there is no second timezone
 * conversion to get right here, only one to not accidentally introduce.
 */
type Post = Doc<"socialPosts">;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-1 text-sm text-muted">
        What&rsquo;s scheduled, published, or still waiting on you.
      </p>

      <AuthorisedBoundary>
        <CalendarBody />
      </AuthorisedBoundary>
    </main>
  );
}

function CalendarBody() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(null);

  const from = startOfMonth(cursor).getTime();
  const to = endOfMonth(cursor).getTime();
  const posts = useQuery(api.socialPosts.inRange, { from, to });

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of posts ?? []) {
      if (!post.scheduledFor) continue;
      const key = dayKey(new Date(post.scheduledFor));
      const list = map.get(key) ?? [];
      list.push(post);
      map.set(key, list);
    }
    return map;
  }, [posts]);

  const counts = useMemo(() => {
    const c = { published: 0, scheduled: 0, drafts: 0, attention: 0 };
    for (const post of posts ?? []) {
      if (post.status === "published") c.published++;
      else if (post.status === "scheduled" || post.status === "publishing") c.scheduled++;
      else if (post.status === "draft") c.drafts++;
      else if (post.status === "failed" || post.status === "partial") c.attention++;
    }
    return c;
  }, [posts]);

  const today = new Date();
  const leading = startOfMonth(cursor).getDay();
  const totalDays = endOfMonth(cursor).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ];

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((c) => addMonths(c, -1))}
            aria-label="Previous month"
            className="rounded-md border border-line px-2 py-1 text-sm text-muted hover:text-foreground"
          >
            ‹
          </button>
          <h2 className="min-w-[9rem] text-center text-sm font-semibold">
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <button
            onClick={() => setCursor((c) => addMonths(c, 1))}
            aria-label="Next month"
            className="rounded-md border border-line px-2 py-1 text-sm text-muted hover:text-foreground"
          >
            ›
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <CountTile label="Published" value={counts.published} tone="ok" />
          <CountTile label="Scheduled" value={counts.scheduled} tone="warn" />
          <CountTile label="Drafts" value={counts.drafts} tone="muted" />
          <CountTile label="Needs attention" value={counts.attention} tone="accent" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-surface-sub px-2 py-1.5 text-center font-mono text-[0.6rem] uppercase tracking-wide text-muted"
          >
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="min-h-24 bg-surface" />;
          const dayPosts = byDay.get(dayKey(date)) ?? [];
          const isToday = isSameDay(date, today);
          const isSelected = selected && isSameDay(date, selected);
          return (
            <button
              key={i}
              onClick={() => setSelected(date)}
              className={[
                "min-h-24 space-y-1 bg-surface p-1.5 text-left align-top transition hover:bg-surface-sub",
                isSelected ? "ring-2 ring-inset ring-accent" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-grid size-5 place-items-center rounded-full font-mono text-[0.65rem]",
                  isToday ? "bg-accent text-white" : "text-muted",
                ].join(" ")}
              >
                {date.getDate()}
              </span>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map((post) => (
                  <div
                    key={post._id}
                    className="truncate rounded bg-surface-sub px-1 py-0.5 font-mono text-[0.6rem] leading-tight text-muted"
                  >
                    {DOT[post.status] ?? "•"} {post.targets[0]?.platform ?? "post"}
                  </div>
                ))}
                {dayPosts.length > 3 && (
                  <p className="px-1 font-mono text-[0.6rem] text-muted">
                    +{dayPosts.length - 3} more
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <DayPanel
          date={selected}
          posts={byDay.get(dayKey(selected)) ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

const DOT: Record<string, string> = {
  published: "🟢",
  scheduled: "🟡",
  publishing: "🟡",
  draft: "⚪",
  failed: "🔴",
  partial: "🔴",
  cancelled: "⚫",
};

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "accent" | "muted";
}) {
  const toneClass = {
    ok: "text-ok",
    warn: "text-warn",
    accent: "text-accent",
    muted: "text-muted",
  }[tone];
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-1.5 text-center">
      <p className={`text-sm font-semibold ${toneClass}`}>{value}</p>
      <p className="font-mono text-[0.55rem] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function DayPanel({
  date,
  posts,
  onClose,
}: {
  date: Date;
  posts: Post[];
  onClose: () => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </h3>
        <div className="flex items-center gap-3">
          <Link
            href="/library?tab=content"
            className="text-xs text-accent hover:opacity-80"
          >
            + Schedule content
          </Link>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-1.5 text-muted hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing scheduled this day.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {posts.map((post) => (
            <PostRow key={post._id} post={post} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PostRow({ post }: { post: Post }) {
  const reschedule = useAction(api.socialPosts.reschedule);
  const cancel = useAction(api.socialPosts.cancel);
  const retryFailed = useAction(api.socialPosts.retryFailed);

  const [when, setWhen] = useState(() => toLocalInputValue(post.scheduledFor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReschedule = post.status === "draft" || post.status === "scheduled";
  const canCancel = post.status === "draft" || post.status === "scheduled";
  const canRetry = post.status === "failed" || post.status === "partial";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line bg-surface-sub p-3">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {post.caption || "(no caption)"}
          </span>
          <span className="block font-mono text-xs text-muted">
            {post.targets
              .map((t) => PLATFORMS[t.platform as Platform]?.name ?? t.platform)
              .join(" · ") || "no targets"}
          </span>
          {post.lastError && <span className="mt-0.5 block text-xs text-accent">{post.lastError}</span>}
        </span>
        <StatusPill status={post.status} />
      </div>

      {(canReschedule || canCancel || canRetry) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canReschedule && (
            <>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
              />
              <button
                onClick={() =>
                  run(() =>
                    reschedule({
                      postId: post._id,
                      scheduledFor: new Date(when).getTime(),
                      timezone: post.timezone,
                    }),
                  )
                }
                disabled={busy}
                className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-foreground disabled:opacity-60"
              >
                Save time
              </button>
            </>
          )}
          {canCancel && (
            <button
              onClick={() => run(() => cancel({ postId: post._id }))}
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => run(() => retryFailed({ postId: post._id }))}
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-foreground disabled:opacity-60"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-accent">{error}</p>}
    </li>
  );
}

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time, no timezone suffix. */
function toLocalInputValue(epochMs: number | undefined): string {
  const d = epochMs ? new Date(epochMs) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
