"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  PLATFORMS,
  TIKTOK_PRIVACY_LEVELS,
  YOUTUBE_TITLE_LIMIT,
  YOUTUBE_VISIBILITIES,
  preflight,
  type MediaFacts,
  type Platform,
} from "@/lib/socialPlatforms";

export interface ComposerMedia {
  id: Id<"assets">;
  facts: MediaFacts;
  url: string | null;
}

/**
 * Compose a post and hand it to Zernio.
 *
 * Modelled on NewInfluencerModal's chrome, this app's only other dialog.
 *
 * Two things here are requirements rather than preferences. TikTok's
 * `content_preview_confirmed` / `express_consent_given` are legal
 * attestations, so they are wired to a checkbox the user actually ticks
 * having seen the video -- never defaulted true. And every video this app
 * makes is AI-generated, so YouTube's `containsSyntheticMedia` and
 * Instagram's `isAiGenerated` default ON; turning them off is a deliberate
 * act, not the path of least resistance.
 *
 * `media` is an array rather than a single item so a carousel (several
 * images posted together) is representable at all -- `mediaAssetIds` was
 * already an array everywhere from `socialPosts.createDraft` down to
 * Zernio's own `mediaItems`, but this component used to hardcode a single
 * element into it. Callers decide what belongs together (the Library's
 * asset grid lets you pick several images; a job page hands over the one
 * video it produced) -- this component just reviews and submits the set.
 */
export function PostComposer({
  jobId,
  media,
  onClose,
}: {
  jobId?: Id<"jobs">;
  media: ComposerMedia[];
  onClose: () => void;
}) {
  const accounts = useQuery(api.social.listAccounts);
  const createDraft = useMutation(api.socialPosts.createDraft);
  const schedule = useAction(api.socialPosts.schedule);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Per-platform extras, keyed by platform rather than by account: two
  // TikTok accounts in one post share one set of TikTok settings, which is
  // also the shape Zernio's `platformSpecificData` expects.
  const [tiktok, setTiktok] = useState({
    privacy_level: "PUBLIC_TO_EVERYONE",
    allow_comment: true,
    allow_duet: true,
    allow_stitch: true,
    consent: false,
  });
  const [youtube, setYoutube] = useState({
    title: "",
    visibility: "public",
    containsSyntheticMedia: true,
  });
  const [instagram, setInstagram] = useState({ shareToFeed: true, isAiGenerated: true });
  const [linkedin, setLinkedin] = useState({ organizationUrn: "" });

  const [busy, setBusy] = useState<"draft" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = (accounts ?? []).filter((a) => selected.has(a._id));
  const platforms = useMemo(
    () => [...new Set(chosen.map((a) => a.platform as Platform))],
    [chosen],
  );

  // Real allowed values for the selected TikTok account(s), not the static
  // four-value list -- Zernio grants each creator its own subset, and
  // posting outside it is rejected at publish time. Keyed as a plain string
  // (not the array itself) so the effect below doesn't refetch on every
  // render just because `chosen` is a fresh array each time.
  const tiktokIdsKey = chosen
    .filter((a) => a.platform === "tiktok")
    .map((a) => a._id)
    .join(",");
  const mediaKind = media.length === 0 ? undefined : media[0].facts.kind === "video" ? "video" : "photo";

  const fetchTiktokCreatorInfo = useAction(api.social.tiktokCreatorInfo);
  const [tiktokPrivacyLevels, setTiktokPrivacyLevels] = useState<
    { value: string; label: string }[] | null
  >(null);

  useEffect(() => {
    // No synchronous setState in the effect body itself -- even the "nothing
    // selected" case resolves through the same async continuation below, so
    // every update happens from a callback rather than the effect's own run.
    let cancelled = false;
    const ids = tiktokIdsKey ? tiktokIdsKey.split(",") : [];
    Promise.all(
      ids.map((id) =>
        fetchTiktokCreatorInfo({
          socialAccountId: id as Id<"socialAccounts">,
          mediaType: mediaKind,
        }).catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const lists = results.filter((r) => r !== null).map((r) => r.privacyLevels);
      if (lists.length === 0) {
        // Nothing selected, or every lookup failed -- fall back to the
        // static list rather than block posting over a Zernio hiccup.
        setTiktokPrivacyLevels(null);
        return;
      }
      // A level must be valid for every selected TikTok account, not just
      // one of them, so intersect rather than union.
      const [first, ...rest] = lists;
      setTiktokPrivacyLevels(
        first.filter((level) => rest.every((list) => list.some((l) => l.value === level.value))),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokIdsKey, mediaKind, fetchTiktokCreatorInfo]);

  // Derived, not stored: if the creator's real options don't include
  // whatever's currently selected (their first load, or a stricter set for
  // a newly-added second account), fall back to the first real option
  // instead of sending a value TikTok will reject.
  const tiktokPrivacyOptions = tiktokPrivacyLevels ?? TIKTOK_PRIVACY_LEVELS;
  const effectiveTiktokPrivacyLevel = tiktokPrivacyOptions.some(
    (l) => l.value === tiktok.privacy_level,
  )
    ? tiktok.privacy_level
    : (tiktokPrivacyOptions[0]?.value ?? tiktok.privacy_level);

  const issues = useMemo(() => {
    // A Set, not an array: preflight() re-checks the caption against the
    // same limit for every asset, and that message is identical every time --
    // collecting into a Set is what keeps a 3-image carousel from showing the
    // same "caption too long" line three times over.
    const out = new Set<string>();
    for (const platform of platforms) {
      if (media.length === 0) {
        for (const issue of preflight(platform, caption, null)) out.add(issue);
        continue;
      }
      for (const item of media) {
        for (const issue of preflight(platform, caption, item.facts)) out.add(issue);
      }
    }
    if (platforms.includes("tiktok") && !tiktok.consent) {
      out.add("TikTok requires confirming the preview and consent before posting.");
    }
    if (platforms.includes("tiktok") && tiktokPrivacyLevels?.length === 0) {
      out.add(
        "These TikTok accounts have no privacy level in common -- post to them separately.",
      );
    }
    if (platforms.includes("youtube") && youtube.title.length > YOUTUBE_TITLE_LIMIT) {
      out.add(`YouTube title is over ${YOUTUBE_TITLE_LIMIT} characters.`);
    }
    return [...out];
  }, [platforms, caption, media, tiktok.consent, tiktokPrivacyLevels, youtube.title]);

  function buildTargets() {
    return chosen.map((account) => {
      const platform = account.platform as Platform;
      let platformSpecificData: Record<string, unknown> | undefined;
      if (platform === "tiktok") {
        platformSpecificData = {
          privacy_level: effectiveTiktokPrivacyLevel,
          allow_comment: tiktok.allow_comment,
          allow_duet: tiktok.allow_duet,
          allow_stitch: tiktok.allow_stitch,
          content_preview_confirmed: tiktok.consent,
          express_consent_given: tiktok.consent,
        };
      } else if (platform === "youtube") {
        platformSpecificData = {
          title: youtube.title || caption.split("\n")[0].slice(0, YOUTUBE_TITLE_LIMIT),
          visibility: youtube.visibility,
          containsSyntheticMedia: youtube.containsSyntheticMedia,
        };
      } else if (platform === "instagram") {
        platformSpecificData = {
          shareToFeed: instagram.shareToFeed,
          isAiGenerated: instagram.isAiGenerated,
        };
      } else if (platform === "linkedin" && linkedin.organizationUrn.trim()) {
        platformSpecificData = { organizationUrn: linkedin.organizationUrn.trim() };
      }

      return {
        platform,
        zernioAccountId: account.zernioAccountId,
        socialAccountId: account._id,
        status: "pending",
        platformSpecificData,
      };
    });
  }

  async function submit(mode: "draft" | "schedule") {
    if (media.length === 0) return;
    setBusy(mode);
    setError(null);
    try {
      const postId = await createDraft({
        caption,
        mediaAssetIds: media.map((m) => m.id),
        jobId,
        targets: buildTargets(),
        scheduledFor: when ? new Date(when).getTime() : undefined,
        timezone,
      });
      if (mode === "schedule") await schedule({ postId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const canSubmit = chosen.length > 0 && media.length > 0 && issues.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="composer-title" className="text-lg font-semibold">
            Schedule post
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-surface-sub hover:text-foreground"
          >
            ×
          </button>
        </div>

        {/* TikTok's consent is an attestation about *this* media, so it has
            to be on screen next to it -- every selected item, not just one,
            since a carousel's consent covers the whole set. */}
        {media.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {media.map((item) =>
              !item.url ? null : item.facts.kind === "video" ? (
                <video
                  key={item.id}
                  src={item.url}
                  controls
                  playsInline
                  className="h-48 w-auto shrink-0 rounded-xl border border-line bg-black object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={item.id}
                  src={item.url}
                  alt=""
                  className="h-48 w-auto shrink-0 rounded-xl border border-line object-contain"
                />
              ),
            )}
          </div>
        )}
        {media.length > 1 && (
          <p className="mt-1.5 text-xs text-muted">{media.length} items, posted as a carousel.</p>
        )}

        <Label>Post to</Label>
        {accounts === undefined ? (
          <p className="text-xs text-muted">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface-sub p-3 text-xs text-muted">
            No accounts connected yet.{" "}
            <a href="/connections" className="text-accent hover:opacity-80">
              Connect one
            </a>
            .
          </p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((account) => (
              <label
                key={account._id}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(account._id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(account._id);
                    else next.delete(account._id);
                    setSelected(next);
                  }}
                />
                <span className="flex-1 truncate">
                  {PLATFORMS[account.platform as Platform]?.name ?? account.platform} · @
                  {account.username}
                </span>
              </label>
            ))}
          </div>
        )}

        <Label>Caption</Label>
        <textarea
          rows={4}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="What's this post about?"
          className="w-full resize-none rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {platforms.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[0.6rem] uppercase tracking-wide text-muted">
            {platforms.map((p) => (
              <span
                key={p}
                className={caption.length > PLATFORMS[p].captionLimit ? "text-accent" : ""}
              >
                {PLATFORMS[p].name} {caption.length}/{PLATFORMS[p].captionLimit}
              </span>
            ))}
          </p>
        )}

        <Label>When</Label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          {when ? `Scheduled in ${timezone}.` : "Leave empty to publish immediately."}
        </p>

        {platforms.includes("tiktok") && (
          <Panel title="TikTok">
            <Row>
              <span className="flex-1">Who can see this</span>
              <select
                value={effectiveTiktokPrivacyLevel}
                onChange={(e) => setTiktok({ ...tiktok, privacy_level: e.target.value })}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                {tiktokPrivacyOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Row>
            {tiktokPrivacyLevels !== null && (
              <p className="text-xs text-muted">
                Only what {tiktokIdsKey.includes(",") ? "these accounts allow" : "this account allows"}
                {" "}is shown -- TikTok grants each creator its own subset.
              </p>
            )}
            <Toggle
              label="Allow comments"
              checked={tiktok.allow_comment}
              onChange={(v) => setTiktok({ ...tiktok, allow_comment: v })}
            />
            <Toggle
              label="Allow duet"
              checked={tiktok.allow_duet}
              onChange={(v) => setTiktok({ ...tiktok, allow_duet: v })}
            />
            <Toggle
              label="Allow stitch"
              checked={tiktok.allow_stitch}
              onChange={(v) => setTiktok({ ...tiktok, allow_stitch: v })}
            />
            <label className="mt-2 flex items-start gap-2 rounded-lg border border-accent bg-accent-soft p-3 text-xs">
              <input
                type="checkbox"
                checked={tiktok.consent}
                onChange={(e) => setTiktok({ ...tiktok, consent: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                I have reviewed this video and agree to TikTok&rsquo;s Music Usage
                Confirmation. TikTok requires this for every post.
              </span>
            </label>
          </Panel>
        )}

        {platforms.includes("youtube") && (
          <Panel title="YouTube">
            <input
              value={youtube.title}
              onChange={(e) => setYoutube({ ...youtube, title: e.target.value })}
              placeholder="Title (defaults to the caption's first line)"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <Row>
              <span className="flex-1">Visibility</span>
              <select
                value={youtube.visibility}
                onChange={(e) => setYoutube({ ...youtube, visibility: e.target.value })}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                {YOUTUBE_VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Row>
            <Toggle
              label="Disclose as AI-generated"
              checked={youtube.containsSyntheticMedia}
              onChange={(v) => setYoutube({ ...youtube, containsSyntheticMedia: v })}
            />
          </Panel>
        )}

        {platforms.includes("instagram") && (
          <Panel title="Instagram">
            <Toggle
              label="Also share to feed"
              checked={instagram.shareToFeed}
              onChange={(v) => setInstagram({ ...instagram, shareToFeed: v })}
            />
            <Toggle
              label="Label as AI-generated"
              checked={instagram.isAiGenerated}
              onChange={(v) => setInstagram({ ...instagram, isAiGenerated: v })}
            />
          </Panel>
        )}

        {platforms.includes("linkedin") && (
          <Panel title="LinkedIn">
            <input
              value={linkedin.organizationUrn}
              onChange={(e) => setLinkedin({ organizationUrn: e.target.value })}
              placeholder="Organization URN (blank posts as you)"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </Panel>
        )}

        {issues.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg border border-accent bg-accent-soft p-3 text-xs text-accent">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-accent">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => submit("draft")}
            disabled={busy !== null || media.length === 0 || chosen.length === 0}
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-foreground disabled:opacity-60"
          >
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={() => submit("schedule")}
            disabled={busy !== null || !canSubmit}
            className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy === "schedule" ? "Scheduling…" : when ? "Schedule" : "Publish now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </p>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface-sub p-3">
      <h3 className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-sm">{children}</div>;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
