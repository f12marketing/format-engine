"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../../convex/_generated/api";
import type { AttributionRow, SyncResult } from "../../../convex/analytics";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { getFormat } from "@/formats";
import { PLATFORMS, type Platform } from "@/lib/socialPlatforms";

/**
 * Performance across every connected platform, from Zernio's own numbers.
 *
 * No website metrics here -- Zernio has no idea what your site's traffic
 * looks like, and a card that always reads zero is worse than no card.
 *
 * Two sources, kept deliberately separate (see convex/analytics.ts): the
 * daily/platform rollup for the KPI tiles and the growth charts, and each
 * post's own attribution for By Account and By Content Type. Summing across
 * both would double-count; the page never does.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

type RangeKey = "7d" | "30d" | "quarter";
const RANGES: { value: RangeKey; label: string; days: number }[] = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "quarter", label: "Quarter", days: 90 },
];

type Metric = "views" | "likes" | "comments" | "posts";
const METRICS: { value: Metric; label: string }[] = [
  { value: "views", label: "Views" },
  { value: "likes", label: "Likes" },
  { value: "comments", label: "Comments" },
  { value: "posts", label: "Posts" },
];

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted">
        Track your content performance across every connected platform.
      </p>

      <AuthorisedBoundary>
        <AnalyticsBody />
      </AuthorisedBoundary>
    </main>
  );
}

function AnalyticsBody() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [metric, setMetric] = useState<Metric>("views");

  const days = RANGES.find((r) => r.value === range)!.days;
  // "Now" fixed for the page's lifetime rather than recomputed on every
  // render or range switch -- there's no reason the moment should move under
  // the user just because they picked a different window.
  const toDate = useMemo(() => new Date(), []);
  const fromDate = useMemo(() => new Date(toDate.getTime() - days * DAY_MS), [toDate, days]);

  const daily = useQuery(api.analytics.dailyInRange, {
    from: toDateStr(fromDate),
    to: toDateStr(toDate),
  });
  const attribution = useQuery(api.analytics.attributionInRange, {
    from: fromDate.getTime(),
    to: toDate.getTime(),
  });

  const syncNow = useAction(api.analytics.syncNow);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  async function refresh() {
    setSyncing(true);
    setSyncResult(null);
    try {
      setSyncResult(await syncNow({ days }));
    } finally {
      setSyncing(false);
    }
  }

  const totals = useMemo(() => {
    const t = { views: 0, likes: 0, comments: 0, shares: 0 };
    for (const row of daily ?? []) {
      t.views += row.views;
      t.likes += row.likes;
      t.comments += row.comments;
      t.shares += row.shares;
    }
    return t;
  }, [daily]);

  const postCount = useMemo(
    () => new Set((attribution ?? []).map((r) => r.postId)).size,
    [attribution],
  );

  // One point per day, summed across every platform. Posts here is Zernio's
  // own per-platform postCount summed across platforms -- a post that went
  // to two platforms the same day counts twice on this line, which is fine
  // for a shape-of-activity chart but is NOT the same number as the "Posts"
  // KPI tile above, which counts distinct posts instead.
  const series = useMemo(() => {
    const byDate = new Map<string, { views: number; likes: number; comments: number; posts: number }>();
    for (const row of daily ?? []) {
      const acc = byDate.get(row.date) ?? { views: 0, likes: 0, comments: 0, posts: 0 };
      acc.views += row.views;
      acc.likes += row.likes;
      acc.comments += row.comments;
      acc.posts += row.postCount;
      byDate.set(row.date, acc);
    }
    const dates = [...byDate.keys()].sort();
    return dates.reduce<{ date: string; value: number; cumulative: number }[]>((acc, date) => {
      const point = byDate.get(date)!;
      const runningTotal = (acc.at(-1)?.cumulative ?? 0) + point[metric];
      acc.push({
        date: date.slice(5), // MM-DD, the year is implied by the range picker
        value: point[metric],
        cumulative: runningTotal,
      });
      return acc;
    }, []);
  }, [daily, metric]);

  const byPlatform = useMemo(() => {
    const map = new Map<string, { views: number; likes: number; comments: number; shares: number; posts: number }>();
    for (const row of daily ?? []) {
      const acc = map.get(row.platform) ?? { views: 0, likes: 0, comments: 0, shares: 0, posts: 0 };
      acc.views += row.views;
      acc.likes += row.likes;
      acc.comments += row.comments;
      acc.shares += row.shares;
      acc.posts += row.postCount;
      map.set(row.platform, acc);
    }
    return [...map.entries()]
      .map(([platform, m]) => ({ platform, ...m }))
      .sort((a, b) => b.views - a.views);
  }, [daily]);

  const byAccount = useMemo(() => groupAttribution(attribution, (r) => `${r.socialAccountId}`, (r) => `${PLATFORMS[r.platform as Platform]?.name ?? r.platform} · @${r.username}`), [attribution]);
  const byFormat = useMemo(() => groupAttribution(attribution, (r) => r.formatId ?? "unknown", (r) => getFormat(r.formatId ?? "")?.name ?? r.formatId ?? "Unknown"), [attribution]);

  const loading = daily === undefined || attribution === undefined;
  const noDataYet = !loading && daily!.length === 0 && attribution!.length === 0;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={[
                "rounded-lg px-3 py-1.5 text-sm transition",
                range === r.value
                  ? "bg-surface-sub font-medium text-foreground"
                  : "text-muted hover:bg-surface-sub hover:text-foreground",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={syncing}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {syncing ? "Refreshing…" : "Refresh metrics"}
        </button>
      </div>

      {syncResult && <SyncBanner result={syncResult} />}

      {loading ? (
        <div className="mt-4 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : noDataYet ? (
        <div className="mt-4 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No analytics yet. Publish a post, then hit &ldquo;Refresh metrics&rdquo; -- or wait for
          the hourly sync.
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <KpiTile label="Total Views" value={totals.views} />
            <KpiTile label="Total Likes" value={totals.likes} />
            <KpiTile label="Total Comments" value={totals.comments} />
            <KpiTile label="Total Shares" value={totals.shares} />
            <KpiTile label="Posts" value={postCount} />
          </div>

          <div className="mt-4 flex gap-1.5">
            {METRICS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMetric(m.value)}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition",
                  metric === m.value
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-line text-muted hover:text-foreground",
                ].join(" ")}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Cumulative Growth" data={series} dataKey="cumulative" />
            <ChartCard title="Growth Per Day" data={series} dataKey="value" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <BreakdownCard
              title="By Platform"
              rows={byPlatform.map((p) => ({
                key: p.platform,
                label: PLATFORMS[p.platform as Platform]?.name ?? p.platform,
                sub: `${p.posts} posts`,
                value: p.views,
              }))}
            />
            <BreakdownCard
              title="By Account"
              rows={byAccount.map((a) => ({ key: a.key, label: a.label, sub: `${a.posts} posts`, value: a.views }))}
            />
            <BreakdownCard
              title="By Content Type"
              rows={byFormat.map((f) => ({ key: f.key, label: f.label, sub: `${f.posts} posts`, value: f.views }))}
            />
          </div>
        </>
      )}
    </>
  );
}

function groupAttribution(
  rows: AttributionRow[] | undefined,
  keyOf: (r: AttributionRow) => string,
  labelOf: (r: AttributionRow) => string,
) {
  const map = new Map<
    string,
    { key: string; label: string; views: number; likes: number; comments: number; shares: number; posts: Set<string> }
  >();
  for (const row of rows ?? []) {
    const key = keyOf(row);
    const acc = map.get(key) ?? {
      key,
      label: labelOf(row),
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      posts: new Set<string>(),
    };
    acc.views += row.views;
    acc.likes += row.likes;
    acc.comments += row.comments;
    acc.shares += row.shares;
    acc.posts.add(row.postId);
    map.set(key, acc);
  }
  return [...map.values()]
    .map((v) => ({ ...v, posts: v.posts.size }))
    .sort((a, b) => b.views - a.views);
}

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      <p className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
}: {
  title: string;
  data: { date: string; value: number; cumulative: number }[];
  dataKey: "value" | "cumulative";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">{title}</h3>
      {data.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted">No data in this range.</p>
      ) : (
        <div className="mt-2 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; sub: string; value: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.slice(0, 6).map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {row.value.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sub">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }}
                />
              </div>
              <p className="mt-0.5 font-mono text-[0.6rem] text-muted">{row.sub}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SyncBanner({ result }: { result: SyncResult }) {
  if (result.ok) {
    return (
      <p className="mt-3 rounded-lg border border-ok bg-surface-sub px-3 py-2 text-sm text-ok">
        Synced {result.postsChecked} post{result.postsChecked === 1 ? "" : "s"} over the last{" "}
        {result.days} days.
      </p>
    );
  }
  const copy: Record<typeof result.reason, string> = {
    no_key: "Zernio isn't configured on this deployment yet.",
    not_connected: "Connect a social account first.",
    addon_required:
      "Zernio's Analytics add-on isn't enabled on this plan -- upgrade to pull performance data.",
  };
  return (
    <p className="mt-3 rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm text-muted">
      {copy[result.reason]}
    </p>
  );
}
