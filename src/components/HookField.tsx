"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  AnyoneTab,
  describe as describePerson,
  Faces,
  ImageIcon,
  ImagesTab,
  InfluencersTab,
  PeopleIcon,
  PersonIcon,
  PremadeTab,
  SparkIcon,
  UploadIcon,
  usePeople,
} from "./AvatarField";
import { isVideoRef, useVideoUpload } from "./VideoLibrary";
import { clipName, useClips } from "./TrendingClipField";

/**
 * The hook popup: the opening seconds of a hook + demo ad, chosen one of two
 * ways, grouped that way in the tab row --
 *
 *   Ready to use   My hooks, and My videos (reaction mode) -- any video of
 *                  the client's, or a new upload, used as it is
 *   New            Anyone, Influencers, Pre-made -- someone we film reacting
 *                  ("reaction") -- or, in speaking mode, those and My images:
 *                  someone who says a new line
 *
 * A "clip:" ref from the trending library, which the popup no longer offers,
 * is still described, so older jobs' picks read properly.
 *
 * Unlike the casting popup, nothing is applied on the first tap: a hook is
 * judged by watching it, so a tap selects (a video starts playing with
 * sound) and "Use this hook" applies it. The footer says what the pick will
 * do to the finished video before it's committed to.
 *
 * Stores one string, the same tags every other video/person field uses:
 * "clip:<id>", "video:<assetId>", or a roster ref (convex/lib/roster.ts).
 */
type Mode = "reaction" | "speaking";
type Tab = "mine" | "videos" | "anyone" | "influencers" | "premade" | "images";
type Hook = NonNullable<ReturnType<typeof useHooks>>[number];

function useHooks() {
  return useQuery(api.hooks.list);
}

export function HookField({
  value,
  onChange,
  label = "Hook",
  mode = "reaction",
}: {
  value: unknown;
  onChange: (ref: string | null) => void;
  label?: string;
  mode?: Mode;
}) {
  const ref = typeof value === "string" && value ? value : null;
  const [open, setOpen] = useState(false);
  const data = useHookData();
  const shown = describeHook(ref, data, mode);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5 text-left transition hover:border-accent"
      >
        {shown.videoUrl ? (
          <video
            src={`${shown.videoUrl}#t=0.1`}
            poster={shown.poster ?? undefined}
            muted
            playsInline
            preload="metadata"
            className="aspect-[9/16] w-10 shrink-0 rounded-lg bg-black object-cover"
          />
        ) : ref && !isVideoRef(ref) ? (
          <Faces urls={shown.faces} size="md" icon={shown.icon} />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <HookIcon />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown.title}</span>
          <span className="block truncate text-xs text-muted">{shown.sub}</span>
        </span>
        <span className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs group-hover:border-accent">
          {ref ? "Change" : "Choose"}
        </span>
      </button>
      {open && (
        <HookDialog
          label={label}
          mode={mode}
          value={ref}
          data={data}
          onClose={() => setOpen(false)}
          onPick={(r) => {
            onChange(r);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- data

function useHookData() {
  return {
    people: usePeople(),
    clips: useClips(),
    hooks: useHooks(),
    videos: useQuery(api.assets.mediaLibrary, { kind: "video" }),
  };
}
type HookData = ReturnType<typeof useHookData>;

interface Shown {
  title: string;
  sub: string;
  faces: string[];
  icon?: React.ReactNode;
  videoUrl?: string | null;
  poster?: string | null;
}

/** What a ref is, in the words the panel card and the popup footer both use. */
function describeHook(ref: string | null, data: HookData, mode: Mode): Shown {
  if (!ref) {
    return {
      title: "Choose your hook",
      sub: mode === "reaction" ? "One of your hooks or videos, or someone new" : "Reuse a hook, or pick who says a new line",
      faces: [],
    };
  }
  if (ref.startsWith("clip:")) {
    const c = data.clips?.find((x) => x.id === ref.slice(5));
    return {
      title: c ? clipName(c) : "Trending clip",
      sub: ["Trending", c && clock(c.durationSec)].filter(Boolean).join(" · "),
      faces: [],
      videoUrl: c?.url,
    };
  }
  if (ref.startsWith("video:")) {
    const h = data.hooks?.find((x) => x.id === ref.slice(6));
    if (h) return { title: hookTitle(h), sub: hookSub(h), faces: [], videoUrl: h.url, poster: h.posterUrl };
    const vid = data.videos?.find((x) => x.id === ref.slice(6));
    return {
      title: "Your video",
      sub: vid
        ? [vid.uploaded ? "Upload" : "Made here", vid.durationSec ? clock(vid.durationSec) : null].filter(Boolean).join(" · ")
        : "From My videos",
      faces: [],
      videoUrl: vid?.url,
      poster: vid?.posterUrl,
    };
  }
  const person = describePerson(ref, data.people, { label: "" });
  return {
    ...person,
    sub: mode === "reaction" ? "We film them reacting on camera" : "Says a new line in their voice",
  };
}

const KIND_LABEL: Record<Hook["kind"], string> = {
  speaking: "Speaks",
  reaction: "Reaction",
  upload: "Upload",
};

function hookTitle(h: Hook): string {
  return h.line ? `“${h.line}”` : h.kind === "reaction" ? "Reaction you filmed" : "Your uploaded hook";
}

function hookSub(h: Hook): string {
  return [KIND_LABEL[h.kind], h.durationSec ? clock(h.durationSec) : null, new Date(h.createdAt).toLocaleDateString()]
    .filter(Boolean)
    .join(" · ");
}

/** The footer's "here's what this pick does" line. */
function consequence(ref: string | null, data: HookData, mode: Mode): { text: string; cost: string } | null {
  if (!ref) return null;
  if (ref.startsWith("clip:")) return { text: "Opens your video, then cuts hard to your demo.", cost: "Free" };
  if (ref.startsWith("video:")) {
    const h = data.hooks?.find((x) => x.id === ref.slice(6));
    return h?.kind === "speaking"
      ? { text: "Reused as it is, in full — its line becomes the caption.", cost: "Free" }
      : { text: "Reused as it is, then cuts to your demo.", cost: "Free" };
  }
  return mode === "reaction"
    ? { text: "We stage them in a casual selfie and film a few seconds of them reacting.", cost: "AI video" }
    : { text: "They say your hook to camera, in their voice, then it cuts to your demo.", cost: "AI voice + video" };
}

// ---------------------------------------------------------------- the popup

function HookDialog({
  label,
  mode,
  value,
  data,
  onClose,
  onPick,
}: {
  label: string;
  mode: Mode;
  value: string | null;
  data: HookData;
  onClose: () => void;
  onPick: (ref: string | null) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  const [tab, setTab] = useState<Tab>(() => initialTab(value, mode, data));

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  const ready: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "mine", label: "My hooks", icon: <HookIcon size={16} /> },
    ...(mode === "reaction" ? [{ id: "videos" as const, label: "My videos", icon: <VideoIcon /> }] : []),
  ];
  const fresh: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "anyone", label: "Anyone", icon: <PeopleIcon /> },
    { id: "influencers", label: "Influencers", icon: <PersonIcon /> },
    { id: "premade", label: "Pre-made", icon: <SparkIcon /> },
    // A reaction is filmed from a face we cast; a photo of your own is for
    // someone who says a line. Your own videos are under Ready to use.
    ...(mode === "speaking" ? [{ id: "images" as const, label: "My images", icon: <ImageIcon /> }] : []),
  ];
  // Speaking leads with casting, as a new line is the usual reason to be here.
  const groups =
    mode === "reaction"
      ? [
          { title: "Ready to use", tabs: ready },
          { title: "Film someone new", tabs: fresh },
        ]
      : [
          { title: "Say a new line", tabs: fresh },
          { title: "Already made", tabs: ready },
        ];

  const picked = describeHook(chosen, data, mode);
  const effect = consequence(chosen, data, mode);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[3px] sm:p-6" onPointerDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl animate-[quiz-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Choose your hook</h2>
            <p className="mt-0.5 text-sm text-muted">
              {mode === "reaction"
                ? "Open on one of your hooks or videos, or cast someone and we’ll film them reacting."
                : "Reuse a hook you’ve already made, or pick who says a new line."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-sub hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <nav
          // Same inset-shadow baseline as the casting popup, so the active
          // underline can sit inside a horizontally scrolling row.
          className="mt-4 flex shrink-0 items-end gap-1 overflow-x-auto overflow-y-hidden px-3 shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] sm:px-5"
          role="tablist"
        >
          {groups.map((g, gi) => (
            <div key={g.title} className={`flex shrink-0 flex-col ${gi ? "ml-2 border-l border-line pl-2" : ""}`}>
              <span className="px-3 pb-0.5 font-mono text-[0.55rem] uppercase tracking-[0.14em] text-muted">
                {g.title}
              </span>
              <div className="flex gap-1">
                {g.tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={[
                      "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition",
                      tab === t.id ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-h-[320px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {tab === "mine" && <MyHooksTab mode={mode} hooks={data.hooks} chosen={chosen} onSelect={setChosen} onUse={onPick} />}
          {tab === "videos" && <MyVideosTab videos={data.videos} chosen={chosen} onSelect={setChosen} onUse={onPick} />}
          {tab === "anyone" && (
            <AnyoneTab value={chosen} options={{ label }} people={data.people} onPick={(r) => setChosen(r)} />
          )}
          {tab === "influencers" && <InfluencersTab value={chosen} people={data.people} onPick={setChosen} />}
          {tab === "premade" && <PremadeTab value={chosen} people={data.people} onPick={setChosen} />}
          {tab === "images" && <ImagesTab value={chosen} onPick={setChosen} />}
        </div>

        <footer className="shrink-0 border-t border-line px-5 py-3 sm:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <Timeline shown={chosen ? picked : null} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{chosen ? picked.title : "Nothing picked yet"}</p>
              <p className="truncate text-xs text-muted">
                {effect ? effect.text : "Pick a clip to watch it, or someone to cast."}
              </p>
            </div>
            {effect && (
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-accent">
                {effect.cost}
              </span>
            )}
            <button type="button" onClick={close} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => chosen && onPick(chosen)}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_var(--accent)] hover:opacity-90 disabled:opacity-40"
            >
              Use this hook
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function initialTab(value: string | null, mode: Mode, data: HookData): Tab {
  if (!value) return mode === "reaction" ? "mine" : "anyone";
  // A trending clip, from before the tab went: the nearest thing still offered.
  if (value.startsWith("clip:")) return "mine";
  if (value.startsWith("video:")) {
    const isHook = data.hooks?.some((h) => h.id === value.slice(6));
    return isHook || mode === "speaking" ? "mine" : "videos";
  }
  if (value.startsWith("cast:")) return "anyone";
  if (value.startsWith("image:")) return "images";
  if (value.startsWith("gallery:") || data.people.avatars?.find((a) => a.id === value)?.house) return "premade";
  return "influencers";
}

/**
 * The finished video in miniature: the hook, then the demo. The pick fills
 * the hook slot, so what "Use this hook" does is visible, not just described.
 */
function Timeline({ shown }: { shown: Shown | null }) {
  return (
    <div className="flex h-12 w-28 shrink-0 items-stretch gap-1 rounded-lg bg-surface-sub p-1" aria-hidden>
      <span className="relative w-7 overflow-hidden rounded-md bg-accent-soft ring-1 ring-accent/40">
        {shown?.videoUrl ? (
          <video src={`${shown.videoUrl}#t=0.1`} poster={shown.poster ?? undefined} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : shown?.faces[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown.faces[0]} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-accent">
            <HookIcon size={12} />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-accent py-px text-center font-mono text-[0.45rem] font-semibold uppercase text-white">
          Hook
        </span>
      </span>
      <span className="flex flex-1 items-end justify-center rounded-md bg-[repeating-linear-gradient(135deg,var(--line)_0_4px,transparent_4px_8px)] pb-0.5 font-mono text-[0.45rem] uppercase tracking-wider text-muted">
        Your demo
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- My hooks

function MyHooksTab({
  mode,
  hooks,
  chosen,
  onSelect,
  onUse,
}: {
  mode: Mode;
  hooks: Hook[] | undefined;
  chosen: string | null;
  onSelect: (ref: string) => void;
  onUse: (ref: string) => void;
}) {
  const upload = useVideoUpload((assetId) => onSelect(`video:${assetId}`), { asHook: true });
  // A silent reaction can't be a *speaking* hook; everything can open a video hook.
  const shown = (hooks ?? []).filter((h) => mode === "reaction" || h.kind !== "reaction");

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">
        {mode === "reaction"
          ? "Every reaction we film and every speaker we render is kept here, so a hook that works can open your next demo — free."
          : "Every speaker we render is kept here with their line, so a hook that works can open your next demo — free, no new voice or video."}
      </p>
      {upload.error && <p className="text-sm text-accent">{upload.error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <button
          type="button"
          onClick={upload.pick}
          disabled={upload.busy}
          className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-3 text-center text-sm text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-60"
        >
          <span className="grid size-10 place-items-center rounded-full bg-surface-sub">
            <UploadIcon />
          </span>
          {upload.busy ? "Uploading…" : "Upload a hook"}
          <span className="text-[0.65rem]">A few seconds of you, on your phone</span>
        </button>
        {hooks === undefined
          ? Array.from({ length: 3 }, (_, i) => <span key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-surface-sub" />)
          : shown.map((h) => (
              <VideoTile
                key={h.id}
                url={h.url}
                poster={h.posterUrl}
                selected={chosen === `video:${h.id}`}
                badge={KIND_LABEL[h.kind]}
                title={h.line ? `“${h.line}”` : h.kind === "reaction" ? "Reaction" : "Upload"}
                sub={new Date(h.createdAt).toLocaleDateString()}
                seconds={h.durationSec}
                onSelect={() => onSelect(`video:${h.id}`)}
                onUse={() => onUse(`video:${h.id}`)}
              />
            ))}
      </div>
      {hooks !== undefined && !shown.length && (
        <p className="text-xs text-muted">
          No hooks yet. Generate one from the {mode === "reaction" ? "Film someone new" : "Say a new line"} tabs and it lands here.
        </p>
      )}
      {upload.input}
    </div>
  );
}

// ---------------------------------------------------------------- My videos

type LibraryVideo = NonNullable<HookData["videos"]>[number];

/**
 * Any video of the client's -- an upload, or one made here -- opening the
 * demo as it is. Uploading from here takes videos only: the picker is
 * filtered to them, and anything else chosen through "All files" is refused
 * before it's sent.
 */
function MyVideosTab({
  videos,
  chosen,
  onSelect,
  onUse,
}: {
  videos: LibraryVideo[] | undefined;
  chosen: string | null;
  onSelect: (ref: string) => void;
  onUse: (ref: string) => void;
}) {
  const upload = useVideoUpload((assetId) => onSelect(`video:${assetId}`));

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">
        Open on any video of yours, as it is — we use its first few seconds, then cut to your demo. Free.
      </p>
      {upload.error && <p className="text-sm text-accent">{upload.error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <button
          type="button"
          onClick={upload.pick}
          disabled={upload.busy}
          className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-3 text-center text-sm text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-60"
        >
          <span className="grid size-10 place-items-center rounded-full bg-surface-sub">
            <UploadIcon />
          </span>
          {upload.busy ? "Uploading…" : "Upload a video"}
          <span className="text-[0.65rem]">Videos only · MP4, MOV or WebM</span>
        </button>
        {videos === undefined
          ? Array.from({ length: 3 }, (_, i) => <span key={i} className="aspect-[9/16] animate-pulse rounded-2xl bg-surface-sub" />)
          : videos.map((a) => (
              <VideoTile
                key={a.id}
                url={a.url}
                poster={a.posterUrl}
                selected={chosen === `video:${a.id}`}
                badge={a.uploaded ? "Upload" : "Made here"}
                title="Your video"
                sub={new Date(a.createdAt).toLocaleDateString()}
                seconds={a.durationSec}
                onSelect={() => onSelect(`video:${a.id}`)}
                onUse={() => onUse(`video:${a.id}`)}
              />
            ))}
      </div>
      {videos !== undefined && !videos.length && (
        <p className="text-xs text-muted">No videos yet. Upload one, and it stays here for next time.</p>
      )}
      {upload.input}
    </div>
  );
}

function VideoTile({
  url,
  poster,
  selected,
  badge,
  title,
  sub,
  seconds,
  onSelect,
  onUse,
}: {
  url: string | null;
  poster?: string | null;
  selected: boolean;
  badge: string;
  title: string;
  sub?: string;
  seconds?: number;
  onSelect: () => void;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onUse}
      aria-pressed={selected}
      className={[
        "group relative overflow-hidden rounded-2xl text-left transition",
        selected ? "ring-[3px] ring-accent" : "ring-1 ring-line hover:ring-accent",
      ].join(" ")}
    >
      {url ? (
        <video
          // Remounted on select so the chosen tile restarts unmuted.
          key={selected ? "on" : "off"}
          src={selected ? url : `${url}#t=0.1`}
          poster={poster ?? undefined}
          muted={!selected}
          autoPlay={selected}
          loop
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full bg-black object-cover"
          onMouseEnter={(e) => !selected && void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
            if (selected) return;
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0.1;
          }}
        />
      ) : (
        <div className="aspect-[9/16] w-full bg-line-strong" />
      )}
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[0.6rem] font-medium text-white">
        {badge}
      </span>
      {seconds ? (
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 font-mono text-[0.6rem] text-white">
          {clock(seconds)}
        </span>
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-10 text-white">
        <span className="line-clamp-2 text-xs font-medium leading-snug">{title}</span>
        {sub && <span className="block truncate text-[0.6rem] opacity-80">{sub}</span>}
      </span>
      {selected && (
        <span className="pointer-events-none absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-accent text-white shadow">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5 10 17 19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- bits

function clock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A fish hook, since that's the thing being chosen. */
function HookIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3v11a4 4 0 0 1-8 0v-2l-2 2" />
      <path d="M12 3h4" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
