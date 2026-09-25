"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  IMAGE_SETS,
  MAX_UPLOADED_IMAGES,
  SET_CATEGORIES,
  parseImageSource,
  setValue,
  slideCountFor,
  styleFor,
  uploadsValue,
} from "../../../convex/lib/imageSets";
import { buildDeck, templateById } from "../../../convex/lib/imageSlideshowTemplates";
import { SlideStage } from "./SlideStage";
import { useUpload } from "./useUpload";
import { cleanError } from "../wall/WallStudio";

type SetSummary = { id: string; name: string; count: number; covers: string[] };
export type SetImage = {
  id: string;
  url: string | null;
  thumbUrl: string | null;
  description: string;
  photographer: string | null;
  source: "pexels" | "pixabay";
  pageUrl: string | null;
};
/** A photo picked from an image set or a search, now one of the client's own images. */
export type PickedPhoto = { assetId: string; url: string };
type SearchResult = {
  key: string;
  thumbUrl: string;
  description: string;
  photographer: string | null;
  source: "pexels" | "pixabay";
  pageUrl: string | null;
};

const PLACEHOLDER = "linear-gradient(160deg,#cdb9a8 0%,#7b665a 55%,#2e2723 100%)";

// ---------------------------------------------------------------- the field

/**
 * The Images field: what's chosen, as a card, and a Change button that opens
 * the Images popup -- an image set, or the client's own photos.
 */
export function ImageSetField({ value, onChange }: { value: unknown; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5">
        <SourceSummary value={value} large />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent"
        >
          Change
        </button>
      </div>
      {open && (
        <ImageSetDialog
          value={value}
          onClose={() => setOpen(false)}
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** A chosen source at a glance: up to three photos, its name and how many photos it has. */
export function SourceSummary({ value, large = false }: { value: unknown; large?: boolean }) {
  const source = parseImageSource(value);
  const sets = useQuery(api.imageSets.list, source.kind === "set" ? {} : "skip");
  const own = useQuery(
    api.assets.urlsFor,
    source.kind === "uploads" ? { assetIds: source.assetIds.slice(0, 3) as Id<"assets">[] } : "skip",
  );
  const set = source.kind === "set" ? sets?.find((s) => s.id === source.set.id) : undefined;
  const covers =
    source.kind === "set"
      ? (set?.covers ?? [])
      : (own ?? []).map((o) => o?.url).filter((u): u is string => Boolean(u));
  const name = source.kind === "set" ? source.set.name : "Your images";
  const count = source.kind === "set" ? set?.count : source.assetIds.length;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Mosaic covers={covers} size={large ? 46 : 28} />
      <div className="min-w-0">
        <p className={`truncate font-semibold ${large ? "text-sm" : "text-xs"}`}>{name}</p>
        {large && (
          <p className="text-xs text-muted">
            {count === undefined
              ? "Loading…"
              : count === 0
                ? "No photos yet"
                : `${count} photos · ${source.kind === "set" ? "image set" : "your picks"}`}
          </p>
        )}
      </div>
    </div>
  );
}

function Mosaic({ covers, size }: { covers: string[]; size: number }) {
  const shown = covers.slice(0, 3);
  return (
    <span className="relative shrink-0" style={{ width: size + (shown.length > 1 ? 14 : 0), height: size * 1.25 }}>
      {shown.length === 0 && (
        <span className="absolute inset-0 rounded-md" style={{ background: PLACEHOLDER, width: size }} />
      )}
      {shown
        .map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt=""
            className="absolute top-0 rounded-md object-cover ring-2 ring-surface-sub"
            style={{ left: i * 7, width: size, height: size * 1.25, zIndex: 3 - i }}
          />
        ))
        .reverse()}
    </span>
  );
}

// ---------------------------------------------------------------- the popup

type Tab = "sets" | "uploads";

/** The Images popup: choose an image set, or upload your own images. */
export function ImageSetDialog({
  value,
  onChange,
  onClose,
}: {
  value: unknown;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const source = parseImageSource(value);
  const [tab, setTab] = useState<Tab>(source.kind === "uploads" ? "uploads" : "sets");
  useEscape(onClose);

  return (
    <Overlay onClose={onClose} label="Images">
      <div className="flex items-center gap-3 border-b border-line px-5 pt-3.5">
        <div className="flex-1 pb-2">
          <h2 className="text-sm font-semibold">Images</h2>
          <p className="text-xs text-muted">Every slide gets one of these photos. You can swap any of them later.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="flex gap-1 border-b border-line px-5">
        {(
          [
            ["sets", "Choose an image set"],
            ["uploads", "Upload your own images"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              "-mb-px border-b-2 px-3 py-2.5 text-xs font-medium",
              tab === id ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "sets" ? (
        <SetBrowser
          selectedSet={source.kind === "set" ? source.set.id : null}
          onUseSet={(id) => onChange(setValue(id))}
          onUsePhotos={(photos) => onChange(uploadsValue(photos.map((p) => p.assetId)))}
        />
      ) : (
        <UploadPicker
          initial={source.kind === "uploads" ? source.assetIds : []}
          onUse={(ids) => onChange(uploadsValue(ids))}
        />
      )}
    </Overlay>
  );
}

/**
 * Every set as a tile, grouped by category; open one to see all its photos.
 * Above them, a second search bar searches every royalty-free photo rather
 * than filtering the sets.
 *
 * Used by the config popup (to choose a whole set, or a hand-picked handful
 * of searched photos) and by the editor (to pick one photo).
 */
export function SetBrowser({
  selectedSet,
  initialOpen = null,
  onUseSet,
  onPickImage,
  onUsePhotos,
  onPickPhoto,
}: {
  selectedSet: string | null;
  initialOpen?: string | null;
  onUseSet?: (id: string) => void;
  onPickImage?: (img: SetImage) => void;
  /** Several searched photos, in the order picked (the config popup). */
  onUsePhotos?: (photos: PickedPhoto[]) => void;
  /** One searched photo (the editor). */
  onPickPhoto?: (photo: PickedPhoto) => void;
}) {
  const sets = useQuery(api.imageSets.list);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [draft, setDraft] = useState("");
  const [photoQuery, setPhotoQuery] = useState<string | null>(null);

  const byId = useMemo(() => {
    const all: SetSummary[] =
      sets ?? IMAGE_SETS.map((s) => ({ id: s.id, name: s.name, count: -1, covers: [] }));
    return new Map(all.map((s) => [s.id, s]));
  }, [sets]);
  const needle = q.trim().toLowerCase();
  const sections = SET_CATEGORIES.filter((c) => category === "all" || c.id === category)
    .map((c) => ({
      ...c,
      tiles: c.sets
        .map((id) => byId.get(id))
        .filter((s): s is SetSummary => Boolean(s && (!needle || s.name.toLowerCase().includes(needle)))),
    }))
    .filter((c) => c.tiles.length);
  const empty = sets !== undefined && sets.every((s) => s.count === 0);

  const searchBars = (
    <div className="grid gap-2 px-5 pt-4 sm:grid-cols-2">
      <label className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <FolderIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPhotoQuery(null);
            setOpen(null);
          }}
          placeholder={`Filter ${IMAGE_SETS.length} image sets…`}
          className="w-full rounded-lg border border-line bg-surface-sub py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
        />
      </label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPhotoQuery(draft.trim() || null);
        }}
      >
        <label className="relative block flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value) setPhotoQuery(null);
            }}
            placeholder="Search all royalty-free photos…"
            className="w-full rounded-lg border border-line bg-surface-sub py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 rounded-lg bg-accent px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Search
        </button>
      </form>
    </div>
  );

  if (photoQuery) {
    return (
      <>
        {searchBars}
        <PhotoSearch
          key={photoQuery}
          query={photoQuery}
          onBack={() => {
            setPhotoQuery(null);
            setDraft("");
          }}
          onUsePhotos={onUsePhotos}
          onPickPhoto={onPickPhoto}
        />
        <LicenceNote />
      </>
    );
  }

  if (open) {
    const meta = IMAGE_SETS.find((s) => s.id === open);
    return (
      <SetDetail
        id={open}
        name={meta?.name ?? open}
        onBack={() => setOpen(null)}
        onUse={onUseSet ? () => onUseSet(open) : undefined}
        onPickImage={onPickImage}
      />
    );
  }

  return (
    <>
      {searchBars}
      <div className="flex gap-1.5 overflow-x-auto px-5 pb-1 pt-3">
        {[{ id: "all", name: "All" }, ...SET_CATEGORIES].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={[
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition",
              category === c.id
                ? "border-accent bg-accent text-white"
                : "border-line bg-surface text-muted hover:border-accent hover:text-foreground",
            ].join(" ")}
          >
            {c.name}
          </button>
        ))}
      </div>
      {empty && (
        <p className="mx-5 mt-3 rounded-lg border border-warn/40 bg-surface-sub px-3 py-2 text-xs text-muted">
          The image sets haven&rsquo;t been filled yet (<code className="font-mono">npx convex run imageSets:seed</code>
          ). Uploading your own works now.
        </p>
      )}
      <Scroll>
        {sections.map((c) => (
          <section key={c.id} className="pt-4 first:pt-3">
            <h3 className="mb-2.5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {c.name}
              <span className="font-normal normal-case tracking-normal">{c.tiles.length}</span>
            </h3>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
              {c.tiles.map((s) => (
                <SetTile key={s.id} set={s} selected={s.id === selectedSet} onOpen={() => setOpen(s.id)} />
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && (
          <p className="py-10 text-center text-xs text-muted">
            No set matches &ldquo;{q}&rdquo;.{" "}
            <button
              type="button"
              onClick={() => {
                setDraft(q);
                setPhotoQuery(q.trim());
              }}
              className="font-medium text-accent hover:underline"
            >
              Search all photos for it
            </button>
          </p>
        )}
      </Scroll>
      <LicenceNote />
    </>
  );
}

/** A set: its cover photo, with its name and size underneath rather than printed over the picture. */
function SetTile({ set, selected, onOpen }: { set: SetSummary; selected: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group min-w-0 text-left">
      <span
        className={[
          "relative block aspect-[3/4] overflow-hidden rounded-xl ring-offset-2 ring-offset-surface transition",
          selected ? "ring-2 ring-accent" : "ring-1 ring-line group-hover:ring-accent/70",
        ].join(" ")}
        style={set.covers.length ? undefined : { background: PLACEHOLDER }}
      >
        {set.covers[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={set.covers[0]}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        {selected && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-2 py-0.5 text-[0.58rem] font-semibold text-white">
            Selected
          </span>
        )}
      </span>
      <span className="mt-1.5 block truncate text-xs font-semibold">{set.name}</span>
      <span className="block text-[0.65rem] text-muted">
        {set.count < 0 ? "…" : set.count === 0 ? "No photos yet" : `${set.count} photos`}
      </span>
    </button>
  );
}

/** The popup's scrolling body. The grids inside it keep their natural height, so tiles never squash. */
function Scroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto px-5 pb-5 ${className}`}>{children}</div>;
}

/**
 * Search results for every royalty-free photo, paged. In the config popup the
 * photos are picked several at a time, in order, and become the deck's
 * photos; in the editor one click places one. Nothing is stored until picked.
 */
function PhotoSearch({
  query,
  onBack,
  onUsePhotos,
  onPickPhoto,
}: {
  query: string;
  onBack: () => void;
  onUsePhotos?: (photos: PickedPhoto[]) => void;
  onPickPhoto?: (photo: PickedPhoto) => void;
}) {
  const search = useAction(api.imageSets.search);
  const importPhotos = useAction(api.imageSets.importPhotos);
  const [portrait, setPortrait] = useState(true);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multi = Boolean(onUsePhotos);

  async function load(nextPage: number, nextPortrait: boolean) {
    setLoading(true);
    setError(null);
    try {
      const out = await search({ query, page: nextPage, portrait: nextPortrait });
      setResults((r) => {
        const base = nextPage === 1 ? [] : (r ?? []);
        const seen = new Set(base.map((x) => x.key));
        return [...base, ...out.results.filter((x) => !seen.has(x.key))];
      });
      setPage(nextPage);
      setMore(out.more);
    } catch (e) {
      setError(cleanError(e));
      setResults((r) => r ?? []);
    } finally {
      setLoading(false);
    }
  }

  // The first page loads when the results mount: the query is their key.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function use(keys: string[]) {
    setImporting(true);
    setError(null);
    try {
      const photos = (await importPhotos({ keys })).map((p) => ({ assetId: p.assetId, url: p.url ?? "" }));
      if (multi) onUsePhotos?.(photos);
      else if (photos[0]) onPickPhoto?.(photos[0]);
    } catch (e) {
      setError(cleanError(e));
      setImporting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <button type="button" onClick={onBack} className="text-xs text-muted hover:text-accent">
          ‹ Image sets
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          Photos for &ldquo;{query}&rdquo;
          <span className="ml-2 text-xs font-normal text-muted">from Pexels &amp; Pixabay</span>
        </h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={portrait}
            onChange={(e) => {
              setPortrait(e.target.checked);
              void load(1, e.target.checked);
            }}
            className="size-3.5 accent-accent"
          />
          Portrait only
        </label>
        {multi && (
          <button
            type="button"
            onClick={() => use(picked)}
            disabled={!picked.length || importing}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {importing ? "Adding…" : `Use ${picked.length || ""} photo${picked.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
      <p className="px-5 pt-1 text-xs text-muted">
        {multi
          ? `Pick up to ${MAX_UPLOADED_IMAGES}, in the order they should appear — one slide per photo.`
          : "Click a photo to use it."}
      </p>
      {error && <p className="mx-5 mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{error}</p>}
      <Scroll className={`pt-4 ${importing ? "pointer-events-none opacity-60" : ""}`}>
        {results === null ? (
          <p className="py-10 text-center text-xs text-muted">Searching…</p>
        ) : results.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted">
            No photos found{portrait ? " in portrait — try unticking Portrait only" : ""}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
              {results.map((r) => {
                const n = picked.indexOf(r.key);
                return (
                  <figure key={r.key} className="group relative m-0">
                    <button
                      type="button"
                      title={r.description}
                      onClick={() =>
                        multi
                          ? setPicked((p) =>
                              p.includes(r.key)
                                ? p.filter((k) => k !== r.key)
                                : p.length >= MAX_UPLOADED_IMAGES
                                  ? p
                                  : [...p, r.key],
                            )
                          : void use([r.key])
                      }
                      className={[
                        "block aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface-sub ring-offset-1 ring-offset-surface",
                        n >= 0 ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-2 hover:ring-accent",
                      ].join(" ")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.thumbUrl} alt={r.description} loading="lazy" className="size-full object-cover" />
                    </button>
                    {n >= 0 && (
                      <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
                        {n + 1}
                      </span>
                    )}
                    <PhotoCredit photographer={r.photographer} source={r.source} pageUrl={r.pageUrl} />
                  </figure>
                );
              })}
            </div>
            {more && (
              <div className="flex justify-center pt-4">
                <button
                  type="button"
                  onClick={() => load(page + 1, portrait)}
                  disabled={loading}
                  className="rounded-lg border border-line px-4 py-2 text-xs font-medium hover:border-accent disabled:opacity-60"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </Scroll>
    </>
  );
}

function SetDetail({
  id,
  name,
  onBack,
  onUse,
  onPickImage,
}: {
  id: string;
  name: string;
  onBack: () => void;
  onUse?: () => void;
  onPickImage?: (img: SetImage) => void;
}) {
  const images = useQuery(api.imageSets.images, { set: id });
  return (
    <>
      <div className="flex items-center gap-3 px-5 pt-4">
        <button type="button" onClick={onBack} className="text-xs text-muted hover:text-accent">
          ‹ All sets
        </button>
        <h3 className="flex-1 text-sm font-semibold">
          {name}
          {images && <span className="ml-2 font-normal text-muted">{images.length} photos</span>}
        </h3>
        {onUse && (
          <button
            type="button"
            onClick={onUse}
            disabled={!images?.length}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Use this set
          </button>
        )}
      </div>
      {onPickImage && <p className="px-5 pt-1 text-xs text-muted">Click a photo to use it.</p>}
      <Scroll className="pt-4">
        {images === undefined ? (
          <p className="py-10 text-center text-xs text-muted">Loading…</p>
        ) : images.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted">This set has no photos yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {images.map((img) =>
              img.url ? (
                <figure key={img.id} className="group relative m-0">
                  <button
                    type="button"
                    disabled={!onPickImage}
                    onClick={() => onPickImage?.(img as SetImage)}
                    title={img.description}
                    className={[
                      "block aspect-[3/4] w-full overflow-hidden rounded-lg bg-surface-sub ring-1 ring-line",
                      onPickImage ? "hover:ring-2 hover:ring-accent" : "cursor-default",
                    ].join(" ")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.thumbUrl ?? img.url}
                      alt={img.description}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </button>
                  <PhotoCredit photographer={img.photographer} source={img.source} pageUrl={img.pageUrl} />
                </figure>
              ) : null,
            )}
          </div>
        )}
      </Scroll>
      <LicenceNote />
    </>
  );
}

const SOURCE_NAME = { pexels: "Pexels", pixabay: "Pixabay" } as const;

/**
 * "Photo by <name> on <source>", linked to the photo's page -- the credit
 * Pexels' API guidelines ask for, shown on hover so the grid stays clean.
 */
function PhotoCredit({
  photographer,
  source,
  pageUrl,
}: {
  photographer: string | null;
  source: "pexels" | "pixabay";
  pageUrl: string | null;
}) {
  const who = photographer || "a contributor";
  return (
    <figcaption className="absolute inset-x-0 bottom-0 truncate rounded-b-lg bg-black/60 px-1.5 py-1 text-[0.58rem] text-white opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
      Photo by{" "}
      {pageUrl ? (
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-medium underline-offset-2 hover:underline"
        >
          {who}
        </a>
      ) : (
        who
      )}{" "}
      on {SOURCE_NAME[source]}
    </figcaption>
  );
}

/**
 * Where the photos come from and what they may be used for. Both APIs' terms
 * ask for a visible link to them wherever their photos are browsed or
 * searched; both licences allow commercial use without credit, but not
 * selling a photo as it is or implying that someone pictured endorses you.
 */
function LicenceNote() {
  const link = "font-medium text-foreground underline-offset-2 hover:underline";
  return (
    <p className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-[0.65rem] leading-snug text-muted">
      <ShieldIcon />
      <span>
        Photos provided by{" "}
        <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className={link}>
          Pexels
        </a>{" "}
        and{" "}
        <a href="https://pixabay.com" target="_blank" rel="noreferrer" className={link}>
          Pixabay
        </a>
        . Royalty-free: free to use in commercial posts and ads, no credit needed in your posts. Don&rsquo;t sell
        them unaltered or imply that people or brands shown endorse you.
      </span>
    </p>
  );
}

const icon = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function SearchIcon() {
  return (
    <svg {...icon}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg {...icon}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg {...icon} className="shrink-0 text-ok">
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/**
 * Upload your own images: the client's uploaded photos, picked in order (the
 * order is the slide order), plus new uploads, which are picked as they land.
 */
function UploadPicker({ initial, onUse }: { initial: string[]; onUse: (ids: string[]) => void }) {
  const library = useQuery(api.assets.mediaLibrary, { kind: "image" });
  const upload = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string[]>(initial);
  const [local, setLocal] = useState<{ id: string; url: string }[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(() => {
    const fromLibrary = (library ?? [])
      .filter((a) => a.uploaded && a.url)
      .map((a) => ({ id: a.id as string, url: a.url! }));
    const seen = new Set(fromLibrary.map((a) => a.id));
    return [...local.filter((l) => !seen.has(l.id)), ...fromLibrary];
  }, [library, local]);

  function toggle(id: string) {
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_UPLOADED_IMAGES ? p : [...p, id],
    );
  }

  async function onFiles(files: File[]) {
    setError(null);
    setBusy((n) => n + files.length);
    for (const file of files) {
      try {
        const up = await upload(file);
        setLocal((l) => [{ id: up.assetId, url: up.url }, ...l]);
        setPicked((p) => (p.length >= MAX_UPLOADED_IMAGES || p.includes(up.assetId) ? p : [...p, up.assetId]));
      } catch (e) {
        setError(cleanError(e));
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          {busy ? `Uploading ${busy}…` : "+ Upload images"}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void onFiles(files);
          }}
        />
        <p className="flex-1 text-xs text-muted">
          Pick up to {MAX_UPLOADED_IMAGES}, in the order they should appear — one slide per photo.
        </p>
        <button
          type="button"
          onClick={() => onUse(picked)}
          disabled={!picked.length || busy > 0}
          className="rounded-lg border border-accent bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent hover:text-white disabled:opacity-50"
        >
          Use {picked.length || ""} image{picked.length === 1 ? "" : "s"}
        </button>
      </div>
      {error && <p className="mx-5 mt-3 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{error}</p>}
      <div
        className="min-h-40 flex-1 overflow-y-auto p-5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (files.length) void onFiles(files);
        }}
      >
        {library === undefined ? (
          <p className="py-10 text-center text-xs text-muted">Loading your images…</p>
        ) : mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line py-12 text-center text-xs text-muted">
            Drop images here, or use Upload.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-6">
            {mine.map((img) => {
              const n = picked.indexOf(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggle(img.id)}
                  className={[
                    "relative aspect-[3/4] overflow-hidden rounded-lg bg-surface-sub ring-offset-1 ring-offset-surface",
                    n >= 0 ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-accent/60",
                  ].join(" ")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="size-full object-cover" />
                  {n >= 0 && (
                    <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-[0.65rem] font-semibold text-white">
                      {n + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the preview

/**
 * The config page's right-hand panel: the chosen photos under sample words in
 * the style they'll be written in -- what a run starts from.
 */
export function SlideshowPreview({ value }: { value: unknown }) {
  const source = parseImageSource(value);
  const setImages = useQuery(api.imageSets.images, source.kind === "set" ? { set: source.set.id } : "skip");
  const own = useQuery(
    api.assets.urlsFor,
    source.kind === "uploads" ? { assetIds: source.assetIds as Id<"assets">[] } : "skip",
  );
  const photos = useMemo(
    () =>
      (source.kind === "set" ? (setImages ?? []) : (own ?? []))
        .map((p) => ({ id: p?.id as string, url: p?.url ?? null }))
        .filter((p): p is { id: string; url: string } => Boolean(p.id && p.url)),
    [source.kind, setImages, own],
  );

  const style = templateById(styleFor(source));
  const count = slideCountFor(source, style.slideCount);
  const deck = useMemo(
    () =>
      buildDeck(
        style,
        style.sample.slides.map((s, i) => ({ ...s, imagePrompt: "", imageAssetId: photos[i]?.id ?? null })),
      ),
    [style, photos],
  );
  const urls = useMemo(() => Object.fromEntries(photos.map((p) => [p.id, p.url])), [photos]);
  const [i, setI] = useState(0);
  const current = Math.min(i, deck.slides.length - 1);
  const width = deck.ratio === "9:16" ? 230 : 270;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <SlideStage
          slide={deck.slides[current]}
          ratio={deck.ratio}
          urls={urls}
          width={width}
          placeholderBackground={style.sample.background}
          className="rounded-2xl shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/10"
        />
        <Arrow side="left" disabled={current === 0} onClick={() => setI(current - 1)} />
        <Arrow side="right" disabled={current === deck.slides.length - 1} onClick={() => setI(current + 1)} />
      </div>
      <Dots count={deck.slides.length} current={current} onPick={setI} />
      <p className="max-w-[270px] text-center text-xs leading-snug text-muted">
        Sample words in the {style.name.toLowerCase()} style. Yours are written from your prompt across{" "}
        {count} slides{source.kind === "set" ? `, each matched to a ${source.set.name} photo` : ", one per photo"} —
        then you edit everything before it exports.
      </p>
    </div>
  );
}

function Arrow({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={[
        "absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-sm shadow-md transition hover:border-accent disabled:opacity-0",
        side === "left" ? "-left-4" : "-right-4",
      ].join(" ")}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

export function Dots({ count, current, onPick }: { count: number; current: number; onPick?: (i: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          tabIndex={onPick ? 0 : -1}
          aria-label={`Slide ${i + 1}`}
          onClick={() => onPick?.(i)}
          className={[
            "size-2 rounded-full transition",
            i === current ? "bg-accent" : "bg-line-strong",
            onPick ? "hover:bg-accent/60" : "cursor-default",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shell

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Overlay({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-label={label}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-sub hover:text-foreground"
    >
      ×
    </button>
  );
}
