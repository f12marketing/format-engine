"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { FilterChips, StatusPill } from "@/components/StatusPill";
import { PostComposer } from "@/components/PostComposer";

/**
 * Everything the client has, in one place: posts on their way out, content
 * the engine generated, and raw media they uploaded.
 *
 * The three tabs are three different tables' worth of thing, so each owns its
 * own query rather than one query branching -- a post has a status and a
 * schedule, an asset has neither.
 */
type Tab = "posts" | "content" | "media";

const TABS: { value: Tab; label: string }[] = [
  { value: "posts", label: "My Posts" },
  { value: "content", label: "My Content" },
  { value: "media", label: "My Media Bank" },
];

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Library</h1>
      <p className="mt-1 text-sm text-muted">
        Scheduled and published posts, generated content, and uploaded media.
      </p>

      {/* useSearchParams needs a Suspense boundary -- the static header above
          it has nothing to do with which tab is open and shouldn't wait on it. */}
      <Suspense fallback={null}>
        <LibraryBody />
      </Suspense>
    </main>
  );
}

function LibraryBody() {
  const params = useSearchParams();
  const requested = params.get("tab");
  const initialTab: Tab = TABS.some((t) => t.value === requested)
    ? (requested as Tab)
    : "posts";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <>
      <div className="mt-6 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={[
              "rounded-lg px-3 py-1.5 text-sm transition",
              tab === t.value
                ? "bg-surface-sub font-medium text-foreground"
                : "text-muted hover:bg-surface-sub hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AuthorisedBoundary>
        {tab === "posts" ? (
          <PostsTab />
        ) : (
          <AssetsTab source={tab === "content" ? "generated" : "uploaded"} />
        )}
      </AuthorisedBoundary>
    </>
  );
}

type PostFilter = "all" | "scheduled" | "draft" | "published" | "attention";

const POST_FILTERS: { value: PostFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "attention", label: "Needs attention" },
];

function PostsTab() {
  const [filter, setFilter] = useState<PostFilter>("all");

  // "Needs attention" spans two statuses, so it is filtered client-side over
  // the unfiltered page rather than pushed into the index.
  const serverStatus =
    filter === "all" || filter === "attention" ? undefined : filter;

  const { results, status, loadMore } = usePaginatedQuery(
    api.socialPosts.list,
    { status: serverStatus },
    { initialNumItems: 25 },
  );

  const posts =
    filter === "attention"
      ? results.filter((p) => p.status === "failed" || p.status === "partial")
      : results;

  return (
    <>
      <div className="mt-5">
        <FilterChips options={POST_FILTERS} value={filter} onChange={setFilter} />
      </div>

      {status === "LoadingFirstPage" ? (
        <div className="mt-4 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : !posts.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          {filter === "all"
            ? "No posts yet. Generate something, then schedule it."
            : "Nothing here."}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {posts.map((post) => (
            <li
              key={post._id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {post.caption || "(no caption)"}
                </span>
                <span className="block font-mono text-xs text-muted">
                  {post.targets.map((t) => t.platform).join(" · ") || "no targets"}
                  {post.scheduledFor
                    ? ` · ${new Date(post.scheduledFor).toLocaleString()}`
                    : ""}
                </span>
                {post.lastError && (
                  <span className="mt-0.5 block text-xs text-accent">{post.lastError}</span>
                )}
              </span>
              <PostActions postId={post._id} status={post.status} />
              <StatusPill status={post.status} />
            </li>
          ))}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <button
          onClick={() => loadMore(25)}
          className="mt-4 w-full rounded-lg border border-line bg-surface-sub py-2 text-sm text-muted hover:border-accent hover:text-foreground"
        >
          Load more
        </button>
      )}
    </>
  );
}

/**
 * Cancel and retry, on the rows where they mean something. A scheduled post
 * can still be pulled; a failed one goes back to draft rather than silently
 * re-running whatever was wrong with it.
 */
function PostActions({ postId, status }: { postId: Id<"socialPosts">; status: string }) {
  const cancel = useAction(api.socialPosts.cancel);
  const retryFailed = useAction(api.socialPosts.retryFailed);
  const [busy, setBusy] = useState(false);

  const action =
    status === "scheduled" || status === "draft"
      ? ({ label: "Cancel", run: () => cancel({ postId }) } as const)
      : status === "failed" || status === "partial"
        ? ({ label: "Retry", run: () => retryFailed({ postId }) } as const)
        : null;

  if (!action) return null;

  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await action.run();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
    >
      {busy ? "…" : action.label}
    </button>
  );
}

function AssetsTab({ source }: { source: "generated" | "uploaded" }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.assets.library,
    { source },
    { initialNumItems: 24 },
  );
  const [scheduling, setScheduling] = useState<(typeof results)[number] | null>(null);

  if (status === "LoadingFirstPage") {
    return (
      <div className="mt-5 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
    );
  }

  if (!results.length) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
        {source === "generated"
          ? "Nothing generated yet."
          : "No uploads yet."}
      </div>
    );
  }

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((asset) => (
          <div
            key={asset.id}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <div className="grid aspect-square place-items-center bg-surface-sub">
              {asset.kind === "video" && asset.url ? (
                <video
                  src={asset.url}
                  poster={asset.posterUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : asset.kind === "image" && asset.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted">
                  {asset.kind}
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="font-mono text-[0.65rem] uppercase tracking-wide text-muted">
                {asset.kind} · {(asset.bytes / 1024 / 1024).toFixed(1)} MB
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {new Date(asset.createdAt).toLocaleDateString()}
              </p>
              {(asset.kind === "video" || asset.kind === "image") && (
                <button
                  onClick={() => setScheduling(asset)}
                  className="mt-2 w-full rounded-md border border-line py-1.5 text-xs text-muted hover:border-accent hover:text-foreground"
                >
                  Schedule
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {scheduling && (
        <PostComposer
          jobId={scheduling.producedByJobId ?? undefined}
          media={{
            id: scheduling.id,
            url: scheduling.url,
            facts: {
              kind: scheduling.kind,
              bytes: scheduling.bytes,
              width: scheduling.width,
              height: scheduling.height,
              durationSec: scheduling.durationSec,
            },
          }}
          onClose={() => setScheduling(null)}
        />
      )}

      {status === "CanLoadMore" && (
        <button
          onClick={() => loadMore(24)}
          className="mt-4 w-full rounded-lg border border-line bg-surface-sub py-2 text-sm text-muted hover:border-accent hover:text-foreground"
        >
          Load more
        </button>
      )}
    </>
  );
}
