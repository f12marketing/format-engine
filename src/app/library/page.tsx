"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import { FilterChips, StatusPill } from "@/components/StatusPill";
import { PostComposer, type ComposerMedia } from "@/components/PostComposer";

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

  // "Needs attention" spans several conditions rather than one status, so
  // it is filtered client-side over the unfiltered page rather than pushed
  // into the index.
  const serverStatus =
    filter === "all" || filter === "attention" ? undefined : filter;

  const { results, status, loadMore } = usePaginatedQuery(
    api.socialPosts.list,
    { status: serverStatus },
    { initialNumItems: 25 },
  );

  // Only active accounts come back here, so anything a post still targets
  // that isn't in this set has been disconnected since the post was made.
  const activeAccounts = useQuery(api.social.listAccounts);
  const activeAccountIds = useMemo(
    () => new Set((activeAccounts ?? []).map((a) => a._id)),
    [activeAccounts],
  );

  // Only worth flagging while a post still has somewhere to go -- a
  // published or cancelled post targeting a now-dead account is a closed
  // matter, not something to act on. `activeAccounts === undefined` (still
  // loading) never flags anything, so an empty set can't look like every
  // target got disconnected.
  function hasDisconnectedTarget(post: (typeof results)[number]) {
    if (post.status !== "draft" && post.status !== "scheduled") return false;
    if (activeAccounts === undefined) return false;
    return post.targets.some((t) => !activeAccountIds.has(t.socialAccountId));
  }

  const posts =
    filter === "attention"
      ? results.filter(
          (p) => p.status === "failed" || p.status === "partial" || hasDisconnectedTarget(p),
        )
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
                {!post.lastError && hasDisconnectedTarget(post) && (
                  <span className="mt-0.5 block text-xs text-accent">
                    One of this post&rsquo;s accounts has been disconnected.
                  </span>
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

function toComposerMedia(asset: {
  id: Id<"assets">;
  url: string | null;
  kind: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
}): ComposerMedia {
  return {
    id: asset.id,
    url: asset.url,
    facts: {
      kind: asset.kind,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
    },
  };
}

function AssetsTab({ source }: { source: "generated" | "uploaded" }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.assets.library,
    { source },
    { initialNumItems: 24 },
  );
  const [scheduling, setScheduling] = useState<ComposerMedia[] | null>(null);
  const [schedulingJobId, setSchedulingJobId] = useState<Id<"jobs"> | undefined>(undefined);
  // Multi-select is images only -- none of the four platforms accept more
  // than one video in a single post, so a video keeps its own lone
  // "Schedule" button below instead of joining this set.
  const [selected, setSelected] = useState<Set<Id<"assets">>>(new Set());

  function closeComposer() {
    setScheduling(null);
    setSchedulingJobId(undefined);
    setSelected(new Set());
  }

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

  const selectedAssets = results.filter((a) => selected.has(a.id));

  function schedule(assets: (typeof results)[number][]) {
    setScheduling(assets.map(toComposerMedia));
    // Only worth attributing the post to a job when every asset in it agrees
    // on which one -- a mixed-provenance carousel has no single job to point
    // back to, and a wrong guess is worse than leaving it unset.
    const jobIds = new Set(assets.map((a) => a.producedByJobId));
    setSchedulingJobId(jobIds.size === 1 ? assets[0].producedByJobId : undefined);
  }

  return (
    <>
      {selectedAssets.length > 0 && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-accent bg-accent-soft px-4 py-2.5 text-sm">
          <span className="flex-1">
            {selectedAssets.length} image{selectedAssets.length > 1 ? "s" : ""} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
          <button
            onClick={() => schedule(selectedAssets)}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Schedule together
          </button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {results.map((asset) => (
          <div
            key={asset.id}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <div className="relative grid aspect-square place-items-center bg-surface-sub">
              {/* A carousel is all images, so only images join the multi-select --
                  a video keeps its own lone "Schedule" button below instead. */}
              {asset.kind === "image" && (
                <input
                  type="checkbox"
                  checked={selected.has(asset.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(asset.id);
                    else next.delete(asset.id);
                    setSelected(next);
                  }}
                  className="absolute left-2 top-2 z-10 size-4"
                  aria-label="Select for a carousel post"
                />
              )}
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
                  onClick={() => schedule([asset])}
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
        <PostComposer jobId={schedulingJobId} media={scheduling} onClose={closeComposer} />
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
