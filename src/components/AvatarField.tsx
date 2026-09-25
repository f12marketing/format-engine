"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { isVideoRef, VideoLibrary } from "./VideoLibrary";
import { useVideoRefUrl } from "@/hooks/useVideoRefUrl";

/**
 * Who appears in the video -- "Who's walking", "Presenter", "Lead actor"
 * and the rest of `field.avatar()`.
 *
 * A compact card in the panel that opens a casting popup with four ways to
 * choose, one per tab:
 *
 *   Anyone      let us cast: anyone, a woman or a man, a fresh face per video
 *   Influencers the client's own trained influencers and generated faces
 *   Pre-made    the shared gallery of ready-made faces (and the house roster)
 *   My images   a photo the client uploads or already has
 *   Videos      (only where the field allows it) a finished clip instead of a person
 *
 * Whatever is picked is stored as one string; convex/lib/roster.ts documents
 * the tags and resolves each of them to a photo on the server.
 */
type Tab = "anyone" | "influencers" | "premade" | "images" | "videos";

export interface PersonFieldOptions {
  /** The popup's title: the field's own label ("Who's walking"). */
  label: string;
  /**
   * For a field that can be left empty, what empty means ("The default
   * skeleton", "Cast everyone fresh"). It becomes the first choice on the
   * Anyone tab in place of "Anyone".
   */
  emptyLabel?: string;
  /** False where casting a stranger's face makes no sense (Skeleton). Default true. */
  casting?: boolean;
  /** Adds the Videos tab: a finished clip can stand in for a person (Wall of Text). */
  videos?: boolean;
}

export function AvatarField({
  value,
  onChange,
  options,
}: {
  value: unknown;
  onChange: (rosterRef: string | null) => void;
  options: PersonFieldOptions;
}) {
  const ref = typeof value === "string" && value ? value : null;
  const [open, setOpen] = useState(false);
  const people = usePeople();
  const shown = describe(ref, people, options);
  const videoUrl = useVideoRefUrl(ref);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5 text-left transition hover:border-accent"
      >
        {isVideoRef(ref) ? (
          videoUrl ? (
            <video src={videoUrl} muted playsInline preload="metadata" className="aspect-[9/16] w-10 shrink-0 rounded-lg bg-black object-cover" />
          ) : (
            <span className="aspect-[9/16] w-10 shrink-0 rounded-lg bg-line-strong" />
          )
        ) : (
          <Faces urls={shown.faces} size="md" icon={shown.icon} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown.title}</span>
          <span className="block truncate text-xs text-muted">{shown.sub}</span>
        </span>
        <span className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs group-hover:border-accent">
          Change
        </span>
      </button>
      {open && (
        <CastingDialog
          value={ref}
          options={options}
          people={people}
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

/** Who a ref names, for previews outside the picker: a title and up to three faces. */
export function usePersonPreview(ref: string | null) {
  const people = usePeople();
  return describe(ref, people, { label: "" });
}

function usePeople() {
  const avatars = useQuery(api.avatars.list);
  const influencers = useQuery(api.influencers.list);
  const gallery = useQuery(api.galleryFaces.list);
  return { avatars, influencers, gallery };
}
type People = ReturnType<typeof usePeople>;

/** Up to three sample faces from the casting pool, for the stacked previews. */
function samples(people: People, gender?: "woman" | "man"): string[] {
  const pool = (people.gallery ?? []).filter((f) => f.url && (!gender || f.gender === gender));
  // Spread through the pool rather than the first three, so the stack mixes.
  const step = Math.max(1, Math.floor(pool.length / 3));
  return [0, step, step * 2].map((i) => pool[i]?.url).filter((u): u is string => Boolean(u));
}

function describe(
  ref: string | null,
  people: People,
  options: PersonFieldOptions,
): { title: string; sub: string; faces: string[]; icon?: React.ReactNode } {
  if (!ref) {
    return options.emptyLabel
      ? { title: options.emptyLabel, sub: "Tap to cast someone instead", faces: [], icon: <SparkIcon /> }
      : { title: "Choose who appears", sub: "Cast someone, or pick a face", faces: [], icon: <PersonIcon /> };
  }
  if (ref.startsWith("clip:")) {
    return { title: "Trending clip", sub: "Used as-is, with your text on top", faces: [] };
  }
  if (ref.startsWith("video:")) {
    return { title: "Your video", sub: "Used as-is, with your text on top", faces: [] };
  }
  if (ref.startsWith("cast:")) {
    const g = ref.slice(5);
    const gender = g === "woman" || g === "man" ? g : undefined;
    return {
      title: gender === "woman" ? "A woman" : gender === "man" ? "A man" : "Anyone",
      sub: "We cast a fresh face every time you generate",
      faces: samples(people, gender),
    };
  }
  if (ref.startsWith("gallery:")) {
    const f = people.gallery?.find((x) => x.id === ref.slice(8));
    return { title: f?.label ?? "Pre-made face", sub: "Pre-made", faces: f?.url ? [f.url] : [] };
  }
  if (ref.startsWith("influencer:")) {
    const i = people.influencers?.find((x) => x._id === ref.slice(11));
    return { title: i?.name ?? "Influencer", sub: "Your trained influencer", faces: i?.imageUrl ? [i.imageUrl] : [] };
  }
  if (ref.startsWith("image:")) {
    return { title: "Your photo", sub: "From My images", faces: [], icon: <ImageIcon /> };
  }
  const a = people.avatars?.find((x) => x.id === ref);
  return {
    title: a?.name ?? "Avatar",
    sub: a?.house ? "Pre-made" : "Your generated face",
    faces: a?.imageUrl ? [a.imageUrl] : [],
  };
}

// ---------------------------------------------------------------- the popup

function CastingDialog({
  value,
  options,
  people,
  onClose,
  onPick,
}: {
  value: string | null;
  options: PersonFieldOptions;
  people: People;
  onClose: () => void;
  onPick: (ref: string | null) => void;
}) {
  const [tab, setTab] = useState<Tab>(() =>
    isVideoRef(value)
      ? "videos"
      : !value || value.startsWith("cast:")
      ? "anyone"
      : value.startsWith("image:")
        ? "images"
        : value.startsWith("gallery:") || people.avatars?.find((a) => a.id === value)?.house
          ? "premade"
          : "influencers",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "anyone", label: "Anyone", icon: <PeopleIcon /> },
    { id: "influencers", label: "Influencers", icon: <PersonIcon /> },
    { id: "premade", label: "Pre-made", icon: <SparkIcon /> },
    { id: "images", label: "My images", icon: <ImageIcon /> },
    ...(options.videos ? [{ id: "videos" as const, label: "Videos", icon: <VideoIcon /> }] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[3px] sm:p-6"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={options.label}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-4xl animate-[quiz-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
      >
        {/* shrink-0 on the header and tabs: in a max-height column, a tall grid
            below would otherwise squash them to make room. */}
        <header className="flex shrink-0 items-start gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{options.label}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {options.videos
                ? "Pick who we film for you — or bring a video you already have."
                : "Let us cast someone, or pick the face that appears in the video."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-sub hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <nav
          // The baseline is an inset shadow, not a border: a scrolling row clips
          // anything that overhangs it, so the active tab's underline sits
          // inside the row, drawn over this line, instead of overlapping a border.
          className="mt-4 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden px-3 shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] sm:px-5"
          role="tablist"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition",
                tab === t.id
                  ? "border-accent font-semibold text-accent"
                  : "border-transparent text-muted hover:text-foreground",
              ].join(" ")}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-[300px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {tab === "anyone" && <AnyoneTab value={value} options={options} people={people} onPick={onPick} />}
          {tab === "influencers" && <InfluencersTab value={value} people={people} onPick={onPick} />}
          {tab === "premade" && <PremadeTab value={value} people={people} onPick={onPick} />}
          {tab === "images" && <ImagesTab value={value} onPick={onPick} />}
          {tab === "videos" && <VideoLibrary value={value} onPick={onPick} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tabs

function AnyoneTab({
  value,
  options,
  people,
  onPick,
}: {
  value: string | null;
  options: PersonFieldOptions;
  people: People;
  onPick: (ref: string | null) => void;
}) {
  const casting = options.casting !== false;
  const choices: { ref: string | null; title: string; faces: string[]; icon?: React.ReactNode }[] = [
    options.emptyLabel
      ? { ref: null, title: options.emptyLabel, faces: [], icon: <SparkIcon /> }
      : { ref: "cast:any", title: "Anyone", faces: samples(people) },
    ...(casting
      ? [
          { ref: "cast:woman", title: "A woman", faces: samples(people, "woman") },
          { ref: "cast:man", title: "A man", faces: samples(people, "man") },
        ]
      : []),
  ];

  return (
    <div>
      <p className="max-w-xl text-sm text-muted">
        {casting
          ? "We cast a different person each time you generate — the same face all the way through one video. This steers who, without pinning a face. To choose the exact person, use the other tabs."
          : "Leave it to the format's default, or choose someone from the other tabs."}
      </p>
      <div className={`mt-5 grid gap-3 ${choices.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {choices.map((c) => {
          const on = value === c.ref;
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => onPick(c.ref)}
              className={[
                "group flex flex-col items-center gap-3 rounded-2xl border px-4 py-6 transition",
                on
                  ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                  : "border-line bg-surface hover:border-accent/60 hover:bg-accent-soft/50",
              ].join(" ")}
            >
              <Faces urls={c.faces} size="lg" icon={c.icon} />
              <span className={`text-sm ${on ? "font-semibold text-accent" : "font-medium"}`}>{c.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InfluencersTab({
  value,
  people,
  onPick,
}: {
  value: string | null;
  people: People;
  onPick: (ref: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  if (people.avatars === undefined || people.influencers === undefined) return <Loading />;
  const influencers = people.influencers;
  const own = people.avatars.filter((a) => !a.house);

  return (
    <div className="space-y-5">
      {creating ? (
        <NewFaceForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onPick(id);
          }}
        />
      ) : null}
      <Grid>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent"
          >
            <span className="grid size-10 place-items-center rounded-full bg-surface-sub text-xl">+</span>
            New face
            <span className="px-3 text-center text-[0.65rem]">Describe someone, we generate them</span>
          </button>
        )}
        {influencers.map((i) => (
          <FaceTile
            key={i._id}
            url={i.imageUrl}
            title={i.name}
            sub={i.status === "ready" ? "Trained influencer" : i.status === "training" ? "Training…" : "Not trained yet"}
            disabled={i.status !== "ready"}
            selected={value === `influencer:${i._id}`}
            onClick={() => onPick(`influencer:${i._id}`)}
          />
        ))}
        {own.map((a) => (
          <FaceTile
            key={a.id}
            url={a.imageUrl}
            title={a.name}
            sub="Generated face"
            selected={value === a.id}
            onClick={() => onPick(a.id)}
          />
        ))}
      </Grid>
      {!influencers.length && !own.length && !creating && (
        <p className="text-sm text-muted">You haven&apos;t made any influencers yet.</p>
      )}
      <p className="text-xs text-muted">
        Want the same person in every video?{" "}
        <Link href="/influencers" target="_blank" className="font-medium text-accent hover:underline">
          Train an influencer ↗
        </Link>
      </p>
    </div>
  );
}

function PremadeTab({
  value,
  people,
  onPick,
}: {
  value: string | null;
  people: People;
  onPick: (ref: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "woman" | "man">("all");
  if (people.gallery === undefined || people.avatars === undefined) return <Loading />;
  const faces = people.gallery.filter((f) => f.url && (filter === "all" || f.gender === filter));
  const house = filter === "all" ? people.avatars.filter((a) => a.house) : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(
          [
            ["all", "All"],
            ["woman", "Women"],
            ["man", "Men"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={[
              "rounded-full border px-3.5 py-1.5 text-xs transition",
              filter === id ? "border-accent bg-accent text-white" : "border-line hover:border-accent",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      {faces.length + house.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No pre-made faces here yet.</p>
      ) : (
        <Grid>
          {faces.map((f) => (
            <FaceTile
              key={f.id}
              url={f.url}
              title={f.label ?? "Pre-made"}
              sub={f.gender === "woman" ? "Woman" : f.gender === "man" ? "Man" : undefined}
              selected={value === `gallery:${f.id}`}
              onClick={() => onPick(`gallery:${f.id}`)}
            />
          ))}
          {house.map((a) => (
            <FaceTile
              key={a.id}
              url={a.imageUrl}
              title={a.name}
              sub="House roster"
              selected={value === a.id}
              onClick={() => onPick(a.id)}
            />
          ))}
        </Grid>
      )}
    </div>
  );
}

function ImagesTab({ value, onPick }: { value: string | null; onPick: (ref: string) => void }) {
  const images = useQuery(api.assets.mediaLibrary, { kind: "image" });
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const attach = useMutation(api.uploads.attach);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Use a PNG, JPEG or WebP photo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const assetId = await attach({ storageId: storageId as Id<"_storage">, mimeType: file.type, bytes: file.size });
      onPick(`image:${assetId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        A clear, front-facing photo in good light works best. Only use photos of people who&apos;ve agreed to appear.
      </p>
      {error && <p className="text-sm text-accent">{error}</p>}
      <Grid>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-60"
        >
          <span className="grid size-10 place-items-center rounded-full bg-surface-sub">
            <UploadIcon />
          </span>
          {busy ? "Uploading…" : "Upload a photo"}
        </button>
        {/* Uploads only: a generated carousel slide or product render is not a person to cast. */}
        {images === undefined ? null : (
          images.filter((img) => img.uploaded).map((img) => (
            <FaceTile
              key={img.id}
              url={img.url}
              title="Your photo"
              selected={value === `image:${img.id}`}
              onClick={() => onPick(`image:${img.id}`)}
            />
          ))
        )}
      </Grid>
      <input
        ref={input}
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

/** Generate a new face from a description -- the old inline "+ New avatar", now inside the popup. */
function NewFaceForm({ onCreated, onCancel }: { onCreated: (avatarId: string) => void; onCancel: () => void }) {
  const generate = useAction(api.avatars.generate);
  const [name, setName] = useState("");
  const [lookNotes, setLookNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !lookNotes.trim()) {
      setError("Give them a name and describe how they look.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await generate({ name: name.trim(), lookNotes: lookNotes.trim() }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/Uncaught Error: ([^\n]+)/.exec(msg)?.[1] ?? msg);
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div className="space-y-2.5 rounded-2xl border border-accent/40 bg-accent-soft p-4">
      <p className="text-sm font-semibold">A new face</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Mia" className={input} />
      <textarea
        value={lookNotes}
        onChange={(e) => setLookNotes(e.target.value)}
        rows={2}
        placeholder="How they look: age range, style, vibe. We generate a synthetic person — not a real one."
        className={input}
      />
      {error && <p className="text-xs text-accent">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate face · ~$0.05"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-xs text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{children}</div>;
}

function FaceTile({
  url,
  title,
  sub,
  selected,
  disabled,
  onClick,
}: {
  url: string | null;
  title: string;
  sub?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "group relative aspect-[3/4] overflow-hidden rounded-2xl border bg-surface-sub text-left transition",
        selected ? "border-accent ring-[3px] ring-accent" : "border-line hover:-translate-y-0.5 hover:shadow-lg",
        disabled ? "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none" : "",
      ].join(" ")}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="grid size-full place-items-center text-muted">
          <PersonIcon />
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-white">
        <span className="block truncate text-xs font-medium">{title}</span>
        {sub && <span className="block truncate text-[0.6rem] opacity-80">{sub}</span>}
      </span>
      {selected && (
        <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-accent text-xs text-white shadow">
          ✓
        </span>
      )}
    </button>
  );
}

/** Overlapping round faces -- one for a pick, three for "we'll cast from these". */
function Faces({ urls, size, icon }: { urls: string[]; size: "md" | "lg"; icon?: React.ReactNode }) {
  const px = size === "lg" ? "size-14" : "size-10";
  const shown = useMemo(() => urls.slice(0, 3), [urls]);
  if (!shown.length) {
    return (
      <span className={`grid ${px} shrink-0 place-items-center rounded-full bg-accent-soft text-accent`}>
        {icon ?? <PersonIcon />}
      </span>
    );
  }
  return (
    <span className="flex shrink-0">
      {shown.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u}
          src={u}
          alt=""
          className={`${px} rounded-full border-2 border-surface object-cover shadow-sm ${i ? (size === "lg" ? "-ml-5" : "-ml-4") : ""}`}
        />
      ))}
    </span>
  );
}

function Loading() {
  return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
}

const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function PeopleIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 14a5.5 5.5 0 0 1 3 5" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m3.5 15.5 4.2-4.2a2 2 0 0 1 2.8 0l5 5" />
      <circle cx="15.5" cy="9" r="1.5" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg {...svg}>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </svg>
  );
}
