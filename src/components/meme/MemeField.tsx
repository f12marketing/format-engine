"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GREEN_SCREEN, parseMemePick, type KlipyType, type MemePick } from "../../../convex/lib/memeDesign";
import {
  KLIPY_APP_KEY,
  KLIPY_TABS,
  KLIPY_REPORT_REASONS,
  KlipyError,
  klipyAutocomplete,
  klipyCategories,
  klipyCustomerId,
  klipyHideRecent,
  klipyList,
  klipyLocale,
  klipyRecent,
  klipyReport,
  klipyShare,
  klipySuggestions,
  type KlipyCategory,
  type KlipyItem,
} from "@/lib/klipy";
import { clock } from "../HookField";
import { useMediaUpload } from "./useMediaUpload";
import { CHECKER, DropZone, PickedTick, PickerDialog, TabButton, TabGroup } from "./PickerDialog";

/**
 * Green Screen Meme's "Choose meme": the meme popup.
 *
 *   KLIPY   GIFs, Clips, Stickers, Memes, AI Emojis -- trending until you
 *           search, then Klipy's results, exactly as Klipy returns them.
 *           Each also has Recently used (Klipy's per-user list), search
 *           autocomplete and related searches, and Report on a selection.
 *   Yours   My memes (ones uploaded before), Upload new
 *
 * Klipy's rules (see src/lib/klipy.ts) are why its libraries sit in their own
 * group, why the search box says "Search KLIPY", and why "Powered by KLIPY"
 * stays in the footer while they're showing.
 *
 * Like the hook popup, a tap selects and "Use this meme" applies it: a clip
 * is judged by watching it, so a selected clip plays with its sound.
 *
 * Stores a MemePick -- see convex/lib/memeDesign.ts.
 */
type Tab = KlipyType | "mine" | "upload";

const MEME_ACCEPT = "image/gif,image/png,image/jpeg,video/mp4,video/webm,video/quicktime";
const MEME_TYPES = new Set(MEME_ACCEPT.split(","));
const NOUN: Record<KlipyType, string> = Object.fromEntries(KLIPY_TABS.map((t) => [t.type, t.noun])) as Record<
  KlipyType,
  string
>;

export function MemeField({ value, onChange }: { value: unknown; onChange: (pick: MemePick | null) => void }) {
  const pick = parseMemePick(value);
  const upload = useQuery(
    api.assets.mediaInfo,
    pick?.source === "upload" ? { assetId: pick.assetId as Id<"assets"> } : "skip",
  );
  const [open, setOpen] = useState(false);

  const shown =
    pick?.source === "klipy"
      ? { url: pick.previewUrl, isVideo: pick.isVideo, title: pick.title || `A ${NOUN[pick.type]}`, sub: `${NOUN[pick.type]} · via KLIPY` }
      : pick?.source === "upload"
        ? {
            url: upload?.url ?? null,
            isVideo: Boolean(upload?.isVideo),
            title: "Your meme",
            sub: upload?.isVideo ? `Your clip${upload.durationSec ? ` · ${clock(upload.durationSec)}` : ""}` : "Your upload",
          }
        : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-sub p-2.5 text-left transition hover:border-accent"
      >
        {shown?.url ? (
          <span className={`grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg ${CHECKER}`}>
            <Media url={shown.url} isVideo={shown.isVideo} className="size-full object-contain" />
          </span>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <MemeIcon />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown?.title ?? "Choose your meme"}</span>
          <span className="block truncate text-xs text-muted">
            {shown?.sub ?? "GIFs, clips, stickers, memes and AI emojis — or your own"}
          </span>
        </span>
        <span className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs group-hover:border-accent">
          {pick ? "Change" : "Choose"}
        </span>
      </button>
      {open && (
        <MemeDialog
          value={pick}
          onClose={() => setOpen(false)}
          onPick={(p) => {
            onChange(p);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- the popup

interface Chosen {
  pick: MemePick;
  /** For Klipy's Share Trigger: the search that led to it, if any. */
  q?: string;
  label: string;
  sub: string;
}

function MemeDialog({
  value,
  onClose,
  onPick,
}: {
  value: MemePick | null;
  onClose: () => void;
  onPick: (pick: MemePick) => void;
}) {
  const [tab, setTab] = useState<Tab>(value?.source === "upload" ? "mine" : value?.source === "klipy" ? value.type : "gifs");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [query, setQuery] = useState("");
  const customerId = useKlipyCustomerId();
  const klipy = tab !== "mine" && tab !== "upload";

  const use = useCallback(
    (c: Chosen) => {
      if (c.pick.source !== "klipy") return onPick(c.pick);
      klipyShare(c.pick.type, c.pick.slug, customerId, c.q);
      // The share puts it on Recently used; the cached list no longer has it.
      pageCache.delete(`${c.pick.type}|${RECENT}`);
      // A search for a green screen finds ones whose titles never say so.
      onPick(GREEN_SCREEN.test(c.q ?? "") ? { ...c.pick, greenScreen: true } : c.pick);
    },
    [customerId, onPick],
  );

  const upload = useMediaUpload((assetId) => onPick({ source: "upload", assetId }), {
    as: "meme",
    accept: MEME_ACCEPT,
    allowed: (mime) => MEME_TYPES.has(mime),
    rejected: "isn't a GIF, PNG, JPG or a MP4, WebM or MOV clip.",
  });

  return (
    <PickerDialog
      wide
      title="Choose your meme"
      blurb="The reaction your caption sets up. Green screen memes get their green keyed out — and you can move, size and flip any of them in the editor."
      onClose={onClose}
      tabs={
        <>
          <TabGroup>KLIPY</TabGroup>
          {KLIPY_TABS.map((t) => (
            <TabButton key={t.type} on={tab === t.type} onClick={() => setTab(t.type)}>
              {t.label}
            </TabButton>
          ))}
          <span className="mx-2 mb-2.5 h-5 w-px shrink-0 self-end bg-line" />
          <TabGroup>Yours</TabGroup>
          <TabButton on={tab === "mine"} onClick={() => setTab("mine")}>
            My memes
          </TabButton>
          <TabButton on={tab === "upload"} onClick={() => setTab("upload")}>
            Upload new
          </TabButton>
        </>
      }
      footer={
        tab === "upload" ? undefined : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{chosen?.label ?? "Nothing picked yet"}</p>
              <p className="truncate text-xs text-muted">
                {chosen?.sub ?? "Tap to preview; double-click to use it straight away."}
              </p>
            </div>
            {klipy && chosen?.pick.source === "klipy" && (
              <ReportButton key={chosen.pick.slug} pick={chosen.pick} customerId={customerId} />
            )}
            {klipy && <PoweredByKlipy />}
            <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent">
              Cancel
            </button>
            <button
              type="button"
              disabled={!chosen}
              onClick={() => chosen && use(chosen)}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_var(--accent)] hover:opacity-90 disabled:opacity-40"
            >
              Use this meme
            </button>
          </div>
        )
      }
    >
      {klipy ? (
        <KlipyBrowser
          key={tab}
          type={tab}
          query={query}
          onQuery={setQuery}
          customerId={customerId}
          chosen={chosen}
          onChoose={setChosen}
          onUse={use}
        />
      ) : tab === "mine" ? (
        <MyMemes chosen={chosen} onChoose={setChosen} onUse={use} onUpload={() => setTab("upload")} />
      ) : (
        <>
          {upload.error && <p className="mb-3 text-sm text-accent">{upload.error}</p>}
          <DropZone
            busy={upload.busy}
            onPick={upload.pick}
            onFile={upload.uploadFile}
            title="Drop a GIF or clip here, or click to choose one"
            hint="Animated GIFs, PNG stickers, or a short MP4, MOV or WebM clip — a green screen one is keyed for you. It's kept in My memes for next time."
          />
          {upload.input}
        </>
      )}
    </PickerDialog>
  );
}

/** Klipy asks for a stable, anonymous user id: the client's, hashed. */
function useKlipyCustomerId(): string | undefined {
  const me = useQuery(api.clients.me);
  const [id, setId] = useState<string>();
  useEffect(() => {
    if (!me?.id) return;
    let live = true;
    void klipyCustomerId(me.id).then((h) => live && setId(h));
    return () => {
      live = false;
    };
  }, [me?.id]);
  return id;
}

// ---------------------------------------------------------------- Klipy

/**
 * Pages already fetched, per library and search, for as long as the tab is
 * open: flipping between tabs shouldn't spend a request each time, and a
 * testing key only gets 100 an hour.
 */
const pageCache = new Map<string, { items: KlipyItem[]; hasNext: boolean; page: number }>();
/** Recently used's cache key, where a search would go -- a character no search can hold. */
const RECENT = "\u0000recent";
const categoryCache = new Map<KlipyType, KlipyCategory[]>();

/**
 * One request per page at a time: an effect that runs twice (React does so
 * in development) or a quick tab flip back shares the request already out
 * rather than sending another.
 */
const inflight = new Map<string, Promise<unknown>>();
function once<T>(key: string, request: () => Promise<T>): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = request().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

function KlipyBrowser({
  type,
  query,
  onQuery,
  customerId,
  chosen,
  onChoose,
  onUse,
}: {
  type: KlipyType;
  query: string;
  onQuery: (q: string) => void;
  customerId?: string;
  chosen: Chosen | null;
  onChoose: (c: Chosen) => void;
  onUse: (c: Chosen) => void;
}) {
  const [typed, setTypedRaw] = useState(query);
  const [q, setQ] = useState(query.trim());
  // Recently used: Klipy's own per-user list, in place of Trending.
  const [recent, setRecent] = useState(false);
  const [typing, setTyping] = useState(false);
  // Typing is searching, so it leaves Recently used.
  const setTyped = (t: string) => {
    setTypedRaw(t);
    setRecent(false);
  };
  // Tagged with the search it answers: a page for another search is no page at all.
  const [loaded, setLoaded] = useState<{ key: string; items: KlipyItem[]; hasNext: boolean; page: number } | null>(null);
  const key = recent ? `${type}|${RECENT}` : `${type}|${q}`;
  const cachedPage = pageCache.get(key);
  const state = loaded?.key === key ? loaded : cachedPage ? { key, ...cachedPage } : null;
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const error = failed?.key === key ? failed.message : null;
  const [categories, setCategories] = useState<KlipyCategory[]>(() => categoryCache.get(type) ?? []);
  const locale = klipyLocale();
  const req = useRef(0);
  // Read at request time rather than as a dependency: the hash arriving a
  // moment after the popup opens mustn't fetch the first page twice.
  const customer = useRef(customerId);
  useEffect(() => {
    customer.current = customerId;
  }, [customerId]);

  // Search as you type, a beat after you stop.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed.trim());
      onQuery(typed);
    }, 380);
    return () => clearTimeout(t);
  }, [typed, onQuery]);

  /** One page of this search (or of Recently used); every state change waits for Klipy's answer. */
  const fetchPage = useCallback(
    async (page: number) => {
      const key = recent ? `${type}|${RECENT}` : `${type}|${q}`;
      const mine = ++req.current;
      try {
        const res = await once(`${key}|${page}`, () =>
          recent && customer.current
            ? klipyRecent(type, customer.current, page)
            : klipyList(type, { q, page, customerId: customer.current, locale }),
        );
        if (mine !== req.current) return;
        // Appended as they come: Klipy's order, page after page.
        const next = {
          items: page === 1 ? res.items : [...(pageCache.get(key)?.items ?? []), ...res.items],
          hasNext: res.hasNext,
          page,
        };
        pageCache.set(key, next);
        setLoaded({ key, ...next });
        setFailed(null);
      } catch (e) {
        if (mine === req.current) {
          setFailed({ key, message: e instanceof KlipyError ? e.message : "KLIPY couldn't be reached." });
        }
      }
    },
    [type, q, recent, locale],
  );

  useEffect(() => {
    if (!KLIPY_APP_KEY || pageCache.has(key)) return;
    void fetchPage(1);
  }, [key, fetchPage]);

  /** Takes an item off Recently used -- on Klipy's side, and off the grid at once. */
  async function hide(slug: string) {
    if (!customerId) return;
    const drop = (p: { items: KlipyItem[]; hasNext: boolean; page: number }) => ({
      ...p,
      items: p.items.filter((i) => i.kind !== "item" || i.slug !== slug),
    });
    const cached = pageCache.get(key);
    if (cached) pageCache.set(key, drop(cached));
    setLoaded((l) => (l?.key === key ? { key, ...drop(l) } : l));
    await klipyHideRecent(type, customerId, slug).catch(() => {});
  }

  // Related searches for the one just run, in place of the categories.
  const [related, setRelated] = useState<{ q: string; terms: string[] } | null>(null);
  useEffect(() => {
    if (!KLIPY_APP_KEY || !q || recent) return;
    let live = true;
    once(`related|${q}`, () => klipySuggestions(q))
      .then((terms) => live && setRelated({ q, terms }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [q, recent]);
  const relatedTerms = related?.q === q ? related.terms.filter((t) => t.toLowerCase() !== q.toLowerCase()) : [];

  // Completions for what's half typed, while the box has focus.
  const [completions, setCompletions] = useState<{ prefix: string; terms: string[] } | null>(null);
  const prefix = typed.trim();
  useEffect(() => {
    if (!KLIPY_APP_KEY || !typing || prefix.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      once(`complete|${prefix.toLowerCase()}`, () => klipyAutocomplete(prefix))
        .then((terms) => live && setCompletions({ prefix, terms }))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [prefix, typing]);
  const shownCompletions =
    typing && completions?.prefix === prefix
      ? completions.terms.filter((t) => t.toLowerCase() !== prefix.toLowerCase())
      : [];

  async function loadMore(page: number) {
    setMore(true);
    await fetchPage(page);
    setMore(false);
  }

  useEffect(() => {
    if (!KLIPY_APP_KEY || categoryCache.has(type)) return;
    let live = true;
    once(`categories|${type}`, () => klipyCategories(type, locale))
      .then((c) => {
        categoryCache.set(type, c);
        if (live) setCategories(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [type, locale]);

  if (!KLIPY_APP_KEY) return <KlipySetup />;

  const tall = type === "clips";
  const cut = type === "stickers" || type === "emojis";

  return (
    <div>
      <div className="sticky -top-5 z-10 -mx-1 bg-surface px-1 pb-3 pt-0.5">
        <div className="relative">
          <label className="flex items-center gap-2 rounded-full border border-line bg-surface-sub px-3.5 py-2 focus-within:border-accent">
            <SearchIcon />
            <input
              type="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(e) => e.key === "Enter" && setTyping(false)}
              placeholder="Search KLIPY"
              aria-label="Search KLIPY"
              aria-autocomplete="list"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {typed && (
              <button type="button" onClick={() => setTyped("")} className="text-xs text-muted hover:text-foreground">
                Clear
              </button>
            )}
          </label>
          {shownCompletions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Suggested searches"
              className="absolute inset-x-3 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl"
            >
              {shownCompletions.map((term) => (
                <li key={term}>
                  <button
                    type="button"
                    // Before the input's blur, which would close the list first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTyped(term);
                      setTyping(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-sm hover:bg-surface-sub"
                  >
                    <SearchIcon />
                    <Highlight text={term} match={prefix} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          <Chip
            on={recent}
            disabled={!customerId}
            onClick={() => {
              setTypedRaw("");
              setQ("");
              setRecent(true);
            }}
          >
            🕘 Recently used
          </Chip>
          {/* The format's own starting point, then Klipy's related searches -- or its categories. */}
          <Chip on={!recent && q.toLowerCase() === "green screen"} onClick={() => setTyped("green screen")}>
            ✦ green screen
          </Chip>
          {!recent && q && relatedTerms.length > 0 ? (
            <>
              <span className="shrink-0 pl-1 pr-0.5 text-[0.65rem] text-muted">Related</span>
              {relatedTerms.map((term) => (
                <Chip key={term} on={false} onClick={() => setTyped(term)}>
                  {term}
                </Chip>
              ))}
            </>
          ) : (
            categories.map((c) => (
              <Chip key={c.category} on={!recent && q === c.query} onClick={() => setTyped(c.query)}>
                {c.category}
              </Chip>
            ))
          )}
        </div>
      </div>

      <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
        {recent ? "Recently used · by you" : q ? `Results for “${q}”` : "Trending now"}
      </p>

      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-sm text-accent">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void loadMore(state ? state.page + 1 : 1)} className="font-medium underline">
            Try again
          </button>
        </div>
      )}

      {state === null ? (
        error ? null : <div className={`grid gap-2.5 ${tall ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"}`}>
          {Array.from({ length: tall ? 6 : 10 }, (_, i) => (
            <span key={i} className={`${tall ? "aspect-video" : "aspect-square"} animate-pulse rounded-xl bg-surface-sub`} />
          ))}
        </div>
      ) : state.items.length ? (
        <>
          <div className={`grid gap-2.5 ${tall ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"}`}>
            {state.items.map((item) =>
              item.kind === "ad" ? (
                <AdTile key={item.key} raw={item.raw} tall={tall} />
              ) : (
                <KlipyTile
                  key={`${item.slug}-${item.thumb}`}
                  item={item}
                  tall={tall}
                  cut={cut}
                  selected={chosen?.pick.source === "klipy" && chosen.pick.url === item.pick.url}
                  onSelect={() => onChoose(describeKlipy(item, q))}
                  onUse={() => onUse(describeKlipy(item, q))}
                  onHide={recent ? () => void hide(item.slug) : undefined}
                />
              ),
            )}
          </div>
          {state.hasNext && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore(state.page + 1)}
                disabled={more}
                className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-accent disabled:opacity-50"
              >
                {more ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="py-12 text-center text-sm text-muted">
          {recent
            ? `Nothing used yet from ${KLIPY_TABS.find((t) => t.type === type)?.label ?? "here"} — the ones you use show up here.`
            : q
              ? `Nothing on KLIPY for “${q}”. Try another word, or another tab.`
              : "Nothing trending here right now."}
        </p>
      )}
    </div>
  );
}

function describeKlipy(item: Extract<KlipyItem, { kind: "item" }>, q: string): Chosen {
  const noun = NOUN[item.type];
  const shape = item.pick.width && item.pick.height ? (item.pick.width >= item.pick.height ? "landscape" : "portrait") : null;
  return {
    pick: item.pick,
    q,
    label: item.title || `A ${noun}`,
    sub: [
      noun,
      item.type === "clips" ? "plays with its sound" : null,
      GREEN_SCREEN.test(item.title) || GREEN_SCREEN.test(q) ? "green screen — keyed for you" : shape,
      "via KLIPY",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function KlipyTile({
  item,
  tall,
  cut,
  selected,
  onSelect,
  onUse,
  onHide,
}: {
  item: Extract<KlipyItem, { kind: "item" }>;
  tall: boolean;
  cut: boolean;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
  /** In Recently used: take it off the list. */
  onHide?: () => void;
}) {
  // A selected clip plays at full size, with sound: it's judged by watching it.
  const playing = selected && item.type === "clips";
  const tile = (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onUse}
      aria-pressed={selected}
      title={item.title}
      className={[
        "group relative w-full overflow-hidden rounded-xl bg-cover bg-center transition",
        tall ? "aspect-video" : "aspect-square",
        cut ? CHECKER : "bg-surface-sub",
        selected ? "ring-[3px] ring-accent" : "ring-1 ring-line hover:ring-accent",
      ].join(" ")}
      style={item.blur && !cut ? { backgroundImage: `url(${item.blur})` } : undefined}
    >
      {playing ? (
        <video src={item.pick.url} autoPlay loop playsInline className="size-full bg-black object-contain" />
      ) : (
        <Media
          url={item.thumb}
          isVideo={item.thumbIsVideo}
          className={`size-full ${cut ? "object-contain p-1.5" : "object-cover"}`}
          lazy
        />
      )}
      {item.title && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 text-left text-[0.62rem] font-medium leading-tight text-white opacity-0 transition group-hover:opacity-100">
          <span className="line-clamp-2">{item.title}</span>
        </span>
      )}
      {item.type === "clips" && !playing && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-black/60 text-white">
          <SoundIcon />
        </span>
      )}
      {selected && <PickedTick />}
    </button>
  );
  if (!onHide) return tile;
  return (
    <div className="group/tile relative">
      {tile}
      <button
        type="button"
        onClick={onHide}
        title="Remove from Recently used"
        aria-label="Remove from Recently used"
        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-black/80 focus:opacity-100 group-hover/tile:opacity-100"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * An advert Klipy placed among the results, if ads are ever switched on for
 * the key: left where Klipy put it, marked as one, and never selectable.
 */
function AdTile({ raw, tall }: { raw: Record<string, unknown>; tall: boolean }) {
  const image = [raw.image, raw.image_url, raw.preview_url, raw.url].find(
    (u): u is string => typeof u === "string" && /^https:\/\//.test(u),
  );
  const href = [raw.click_url, raw.target_url, raw.link].find((u): u is string => typeof u === "string" && /^https:\/\//.test(u));
  const body = (
    <>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      )}
      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-white">
        Ad
      </span>
    </>
  );
  const cls = `relative block overflow-hidden rounded-xl bg-surface-sub ring-1 ring-line ${tall ? "aspect-video" : "aspect-square"}`;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer sponsored" className={cls}>
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/**
 * Flags the selected item for Klipy's moderators, with one of the reasons its
 * Report API takes. Reporting doesn't hide it here -- Klipy decides that.
 */
function ReportButton({
  pick,
  customerId,
}: {
  pick: Extract<MemePick, { source: "klipy" }>;
  customerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(KLIPY_REPORT_REASONS[0].value);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  if (state === "sent") return <span className="text-xs text-muted">Reported to KLIPY — thanks.</span>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
      >
        <FlagIcon /> Report
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Why are you reporting this?"
        className="rounded-md border border-line bg-surface-sub px-1.5 py-1 text-xs outline-none focus:border-accent"
      >
        {KLIPY_REPORT_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          try {
            await klipyReport(pick.type, pick.slug, reason, customerId);
            setState("sent");
          } catch {
            setState("failed");
          }
        }}
        className="rounded-md border border-accent px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : state === "failed" ? "Try again" : "Send"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-foreground">
        Cancel
      </button>
    </span>
  );
}

/** The typed part of a completion in bold, wherever it falls in it ("im tired **boss**"). */
function Highlight({ text, match }: { text: string; match: string }) {
  const at = text.toLowerCase().indexOf(match.toLowerCase());
  if (at < 0 || !match) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <strong className="font-semibold">{text.slice(at, at + match.length)}</strong>
      {text.slice(at + match.length)}
    </span>
  );
}

function FlagIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

function KlipySetup() {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <MemeIcon />
      </span>
      <p className="mt-3 text-sm font-semibold">KLIPY isn&rsquo;t connected yet</p>
      <p className="mt-1 text-sm text-muted">
        Create an API key in the KLIPY Partner Panel and add it as{" "}
        <code className="rounded bg-surface-sub px-1 font-mono text-xs">NEXT_PUBLIC_KLIPY_APP_KEY</code>. Until then, upload
        your own memes under Yours.
      </p>
    </div>
  );
}

function PoweredByKlipy() {
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[0.65rem] text-muted sm:inline-flex">
      Powered by <strong className="font-extrabold tracking-tight text-foreground">KLIPY</strong>
    </span>
  );
}

// ---------------------------------------------------------------- yours

function MyMemes({
  chosen,
  onChoose,
  onUse,
  onUpload,
}: {
  chosen: Chosen | null;
  onChoose: (c: Chosen) => void;
  onUse: (c: Chosen) => void;
  onUpload: () => void;
}) {
  const memes = useQuery(api.assets.memeLibrary);
  if (memes === undefined) {
    return (
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="aspect-square animate-pulse rounded-xl bg-surface-sub" />
        ))}
      </div>
    );
  }
  if (!memes.length) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        No memes of your own yet.{" "}
        <button type="button" onClick={onUpload} className="font-semibold text-accent underline">
          Upload a GIF or clip
        </button>
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
      {memes.map((m) => {
        const c: Chosen = {
          pick: { source: "upload", assetId: m.id },
          label: m.isVideo ? "Your clip" : m.mimeType === "image/gif" ? "Your GIF" : "Your image",
          sub: [
            "Uploaded",
            m.durationSec ? clock(m.durationSec) : null,
            new Date(m.createdAt).toLocaleDateString(),
            "green keyed out by default",
          ]
            .filter(Boolean)
            .join(" · "),
        };
        const selected = chosen?.pick.source === "upload" && chosen.pick.assetId === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChoose(c)}
            onDoubleClick={() => onUse(c)}
            aria-pressed={selected}
            className={[
              "relative aspect-square overflow-hidden rounded-xl transition",
              CHECKER,
              selected ? "ring-[3px] ring-accent" : "ring-1 ring-line hover:ring-accent",
            ].join(" ")}
          >
            {m.url && <Media url={m.url} isVideo={m.isVideo} className="size-full object-contain" autoPlay={selected} />}
            {selected && <PickedTick />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- bits

/** An image, or a muted looping video -- the same box either way. */
export function Media({
  url,
  isVideo,
  className,
  lazy,
  autoPlay = true,
}: {
  url: string;
  isVideo: boolean;
  className?: string;
  lazy?: boolean;
  autoPlay?: boolean;
}) {
  return isVideo ? (
    <video src={url} muted loop playsInline autoPlay={autoPlay} preload={lazy ? "none" : "metadata"} className={className} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" loading={lazy ? "lazy" : undefined} draggable={false} className={className} />
  );
}

function Chip({
  on,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "shrink-0 rounded-full border px-3 py-1 text-xs capitalize transition disabled:opacity-40",
        on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:border-accent hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function MemeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2" />
      <path d="M8 9.5h.01M16 9.5h.01" strokeWidth="2.6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}
