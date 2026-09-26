"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  PLATFORMS,
  TIKTOK_COMMERCIAL_CONTENT,
  TIKTOK_PRIVACY_LEVELS,
  YOUTUBE_TITLE_LIMIT,
  YOUTUBE_VISIBILITIES,
  preflight,
  type MediaFacts,
  type Platform,
  type TikTokCommercialContent,
  type TikTokSettings,
} from "@/lib/socialPlatforms";
import { AI_PERSON_DISCLOSURE, withAiDisclosure } from "../../convex/lib/disclosure";
import type { TikTokCreatorInfo } from "../../convex/lib/zernio";

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
 * makes is AI-generated, so YouTube's `containsSyntheticMedia`,
 * Instagram's `isAiGenerated` and TikTok's `video_made_with_ai` default ON;
 * turning them off is a deliberate act, not the path of least resistance.
 * When the media shows an AI-generated person, the caption also opens with
 * a disclosure line -- the one New York's synthetic performer law and the EU
 * AI Act want in the ad itself (see convex/lib/disclosure.ts). TikTok's
 * commercial content switch starts off, as TikTok's guidelines require.
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
  // TikTok accounts in one post share one set of TikTok settings. Each
  // account's target gets its own copy, which is where Zernio reads them.
  // TikTok's Content Sharing Guidelines: who can see it, and the comment /
  // duet / stitch switches, start unset -- the creator picks every time.
  const [tiktok, setTiktok] = useState({
    privacy_level: "",
    allow_comment: false,
    allow_duet: false,
    allow_stitch: false,
    consent: false,
    // Business-app accounts reject the label on photo posts, so a carousel
    // starts without it; a video always starts with it.
    madeWithAi: media[0]?.facts.kind !== "image",
    commercial: "none" as TikTokCommercialContent,
  });
  // Null until the user touches it: then it follows what the media shows.
  const [aiDisclosureChoice, setAiDisclosureChoice] = useState<boolean | null>(null);
  const disclosure = useQuery(api.socialPosts.disclosure, {
    jobId,
    mediaAssetIds: media.map((m) => m.id),
  });
  const aiDisclosure = aiDisclosureChoice ?? disclosure?.aiPerson ?? false;
  const [youtube, setYoutube] = useState({
    title: "",
    visibility: "public",
    containsSyntheticMedia: true,
    // COPPA: YouTube wants every upload's audience declared, so there's no
    // default -- the user answers it. Unset blocks posting to YouTube.
    madeForKids: null as boolean | null,
  });
  const [instagram, setInstagram] = useState({
    shareToFeed: true,
    isAiGenerated: true,
    paidPartnership: false,
    sponsors: "",
  });
  // A paid partnership has to say so where people read it (FTC endorsement
  // guides): "#ad" opens the caption unless the user takes it off.
  const paidPartnership = tiktok.commercial === "brand_content" || instagram.paidPartnership;
  const [adTagChoice, setAdTagChoice] = useState(true);
  const adTag = paidPartnership && adTagChoice;
  const body = adTag && !/^#ad\b/i.test(caption.trim()) ? `#ad ${caption.trim()}` : caption;
  const postedCaption = aiDisclosure ? withAiDisclosure(body) : body;
  // The same idea in the media itself: a badge burned into the frame (on by
  // default when it shows an AI person) and a tag in the video's metadata.
  const [burnChoice, setBurnChoice] = useState<boolean | null>(null);
  const burnLabel = burnChoice ?? disclosure?.aiPerson ?? false;
  const hasVideo = media.some((m) => m.facts.kind === "video");
  const [metadataTag, setMetadataTag] = useState(true);
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
  // Each selected TikTok account's creator info, fresh per compose: TikTok's
  // guidelines have the composer show who is posting and honour what that
  // creator allows (privacy levels, interactions, length, daily limit).
  const [tiktokInfos, setTiktokInfos] = useState<TikTokCreatorInfo[] | null>(null);

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
      const infos = results.filter((r) => r !== null);
      // Nothing selected, or every lookup failed -- fall back to the static
      // lists rather than block posting over a Zernio hiccup.
      setTiktokInfos(infos.length ? infos : null);
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokIdsKey, mediaKind, fetchTiktokCreatorInfo]);

  // A level must be valid for every selected TikTok account, not just one of
  // them, so intersect rather than union.
  const tiktokPrivacyLevels = useMemo(() => {
    if (!tiktokInfos) return null;
    const [first, ...rest] = tiktokInfos.map((i) => i.privacyLevels);
    return first.filter((level) => rest.every((list) => list.some((l) => l.value === level.value)));
  }, [tiktokInfos]);
  const tiktokPrivacyOptions = tiktokPrivacyLevels ?? TIKTOK_PRIVACY_LEVELS;
  // Never a default: a choice the creator's real options don't include (or
  // no choice yet) is no choice, and posting waits for one.
  const effectiveTiktokPrivacyLevel = tiktokPrivacyOptions.some((l) => l.value === tiktok.privacy_level)
    ? tiktok.privacy_level
    : "";
  // An interaction the creator switched off in the TikTok app can't be offered.
  const tiktokInteractionOff = (key: "allow_comment" | "allow_duet" | "allow_stitch") =>
    Boolean(tiktokInfos?.some((i) => i.postingLimits.interactionSettings[key]?.enabled === false));
  const tiktokCommercialOptions = tiktokInfos
    ? TIKTOK_COMMERCIAL_CONTENT.filter(
        (c) =>
          c.value === "none" ||
          tiktokInfos.every((i) => (i.commercialContentTypes ?? []).some((t) => t.value === c.value)),
      )
    : TIKTOK_COMMERCIAL_CONTENT;
  const tiktokMaxSec = tiktokInfos
    ? Math.min(...tiktokInfos.map((i) => i.postingLimits.maxVideoDurationSec || Infinity))
    : Infinity;

  const issues = useMemo(() => {
    // A Set, not an array: preflight() re-checks the caption against the
    // same limit for every asset, and that message is identical every time --
    // collecting into a Set is what keeps a 3-image carousel from showing the
    // same "caption too long" line three times over.
    const out = new Set<string>();
    for (const platform of platforms) {
      if (media.length === 0) {
        for (const issue of preflight(platform, postedCaption, null)) out.add(issue);
        continue;
      }
      for (const item of media) {
        for (const issue of preflight(platform, postedCaption, item.facts)) out.add(issue);
      }
    }
    if (platforms.includes("tiktok") && !effectiveTiktokPrivacyLevel) {
      out.add("Choose who can see this on TikTok.");
    }
    for (const info of tiktokInfos ?? []) {
      if (platforms.includes("tiktok") && info.creator.canPostMore === false) {
        out.add(`@${info.creator.nickname} has reached TikTok's posting limit for now -- try again later.`);
      }
    }
    if (platforms.includes("tiktok")) {
      for (const item of media) {
        if (item.facts.kind === "video" && (item.facts.durationSec ?? 0) > tiktokMaxSec) {
          out.add(`TikTok lets this account post videos up to ${Math.floor(tiktokMaxSec)}s.`);
        }
      }
    }
    if (platforms.includes("tiktok") && !tiktok.consent) {
      out.add("TikTok requires confirming the preview and consent before posting.");
    }
    if (platforms.includes("youtube") && youtube.madeForKids === null) {
      out.add("Say whether the YouTube video is made for kids.");
    }
    if (
      platforms.includes("tiktok") &&
      tiktok.commercial === "brand_content" &&
      effectiveTiktokPrivacyLevel === "SELF_ONLY"
    ) {
      out.add("TikTok doesn't allow branded content to be private -- pick who can see it.");
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
  }, [
    platforms,
    postedCaption,
    media,
    tiktok.consent,
    tiktok.commercial,
    effectiveTiktokPrivacyLevel,
    tiktokPrivacyLevels,
    tiktokInfos,
    tiktokMaxSec,
    youtube.title,
    youtube.madeForKids,
  ]);

  function buildTargets() {
    return chosen.map((account) => {
      const platform = account.platform as Platform;
      let platformSpecificData: Record<string, unknown> | undefined;
      if (platform === "tiktok") {
        const tiktokSettings: TikTokSettings = {
          privacy_level: effectiveTiktokPrivacyLevel,
          allow_comment: tiktok.allow_comment && !tiktokInteractionOff("allow_comment"),
          allow_duet: tiktok.allow_duet && !tiktokInteractionOff("allow_duet"),
          allow_stitch: tiktok.allow_stitch && !tiktokInteractionOff("allow_stitch"),
          content_preview_confirmed: tiktok.consent,
          express_consent_given: tiktok.consent,
          video_made_with_ai: tiktok.madeWithAi,
          commercialContentType: tiktok.commercial,
        };
        platformSpecificData = { tiktokSettings };
      } else if (platform === "youtube") {
        platformSpecificData = {
          title: youtube.title || caption.split("\n")[0].slice(0, YOUTUBE_TITLE_LIMIT),
          visibility: youtube.visibility,
          containsSyntheticMedia: youtube.containsSyntheticMedia,
          madeForKids: youtube.madeForKids === true,
        };
      } else if (platform === "instagram") {
        const sponsors = instagram.sponsors
          .split(/[\s,]+/)
          .map((s) => s.replace(/^@/, "").trim())
          .filter(Boolean)
          .slice(0, 2);
        platformSpecificData = {
          shareToFeed: instagram.shareToFeed,
          isAiGenerated: instagram.isAiGenerated,
          ...(instagram.paidPartnership
            ? { isPaidPartnership: true, ...(sponsors.length ? { brandedContentSponsors: sponsors } : {}) }
            : {}),
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
        caption: postedCaption,
        mediaAssetIds: media.map((m) => m.id),
        jobId,
        targets: buildTargets(),
        scheduledFor: when ? new Date(when).getTime() : undefined,
        timezone,
        aiLabel: { burn: burnLabel, metadata: hasVideo && metadataTag },
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
                className={postedCaption.length > PLATFORMS[p].captionLimit ? "text-accent" : ""}
              >
                {PLATFORMS[p].name} {postedCaption.length}/{PLATFORMS[p].captionLimit}
              </span>
            ))}
          </p>
        )}
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-surface-sub p-3 text-xs">
          <input
            type="checkbox"
            checked={aiDisclosure}
            onChange={(e) => setAiDisclosureChoice(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Open the caption with &ldquo;{AI_PERSON_DISCLOSURE}&rdquo;.
            <span className="mt-0.5 block text-muted">
              {disclosure?.aiPerson
                ? "This video shows an AI-generated person. Ads that do must say so in New York, and in the EU under the AI Act -- leave this on unless you've disclosed it another way."
                : "Turn on if this shows an AI-generated person: ads that do must say so in New York and the EU."}
            </span>
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-surface-sub p-3 text-xs">
          <input
            type="checkbox"
            checked={burnLabel}
            onChange={(e) => setBurnChoice(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Burn an &ldquo;AI-generated&rdquo; label into the {hasVideo ? "video" : "image"}.
            <span className="mt-0.5 block text-muted">
              A small badge in the top-left corner. Unlike the caption, it stays on the{" "}
              {hasVideo ? "video" : "image"} when it&rsquo;s downloaded or reposted. Posting takes a
              little longer while it&rsquo;s added; the original stays as it is.
            </span>
          </span>
        </label>
        {hasVideo && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-surface-sub p-3 text-xs">
            <input
              type="checkbox"
              checked={metadataTag}
              onChange={(e) => setMetadataTag(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Tag the video file as AI-generated.
              <span className="mt-0.5 block text-muted">
                Written into the file&rsquo;s metadata, where AI-detection tools look. Most platforms
                strip it on upload, so it complements the labels above rather than replacing them.
              </span>
            </span>
          </label>
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
            {tiktokInfos && (
              <p className="text-xs">
                Posting as{" "}
                <span className="font-semibold">
                  {tiktokInfos.map((i) => `@${i.creator.nickname}`).join(", ")}
                </span>
              </p>
            )}
            <Row>
              <span className="flex-1">Who can see this</span>
              <select
                value={effectiveTiktokPrivacyLevel}
                onChange={(e) => setTiktok({ ...tiktok, privacy_level: e.target.value })}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Choose…
                </option>
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
              disabled={tiktokInteractionOff("allow_comment")}
              onChange={(v) => setTiktok({ ...tiktok, allow_comment: v })}
            />
            {/* TikTok doesn't apply duet or stitch to photo posts. */}
            {mediaKind !== "photo" && (
              <>
                <Toggle
                  label="Allow duet"
                  checked={tiktok.allow_duet}
                  disabled={tiktokInteractionOff("allow_duet")}
                  onChange={(v) => setTiktok({ ...tiktok, allow_duet: v })}
                />
                <Toggle
                  label="Allow stitch"
                  checked={tiktok.allow_stitch}
                  disabled={tiktokInteractionOff("allow_stitch")}
                  onChange={(v) => setTiktok({ ...tiktok, allow_stitch: v })}
                />
              </>
            )}
            {(["allow_comment", "allow_duet", "allow_stitch"] as const).some(tiktokInteractionOff) && (
              <p className="text-xs text-muted">Grayed out: switched off in this creator&rsquo;s TikTok settings.</p>
            )}
            <Toggle
              label="Label as AI-generated"
              checked={tiktok.madeWithAi}
              onChange={(v) => setTiktok({ ...tiktok, madeWithAi: v })}
            />
            {tiktok.madeWithAi && mediaKind === "photo" && (
              <p className="text-xs text-muted">
                TikTok Business accounts can&rsquo;t label photo posts through the API -- if this
                fails, turn the label off here and add it in the TikTok app.
              </p>
            )}
            <Row>
              <span className="flex-1">Commercial content</span>
              <select
                value={tiktok.commercial}
                onChange={(e) =>
                  setTiktok({ ...tiktok, commercial: e.target.value as TikTokCommercialContent })
                }
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                {tiktokCommercialOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Row>
            <p className="text-xs text-muted">
              {tiktok.commercial === "none"
                ? "TikTok requires disclosing any post that promotes a business, product or service -- including your own."
                : tiktok.commercial === "brand_organic"
                  ? "Your video will be labeled “Promotional content”."
                  : "Your video will be labeled “Paid partnership”."}
            </p>
            <label className="mt-2 flex items-start gap-2 rounded-lg border border-accent bg-accent-soft p-3 text-xs">
              <input
                type="checkbox"
                checked={tiktok.consent}
                onChange={(e) => setTiktok({ ...tiktok, consent: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                I have reviewed this video and agree to TikTok&rsquo;s{" "}
                {tiktok.commercial === "brand_content" && (
                  <>
                    <a
                      href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Branded Content Policy
                    </a>{" "}
                    and{" "}
                  </>
                )}
                <a
                  href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Music Usage Confirmation
                </a>
                . TikTok requires this for every post. It can take a few minutes to appear on the
                profile after posting.
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
            <Row>
              <span className="flex-1">Made for kids?</span>
              <select
                value={youtube.madeForKids === null ? "" : youtube.madeForKids ? "yes" : "no"}
                onChange={(e) => setYoutube({ ...youtube, madeForKids: e.target.value === "yes" })}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Choose…
                </option>
                <option value="no">No, it&apos;s not made for kids</option>
                <option value="yes">Yes, it&apos;s made for kids</option>
              </select>
            </Row>
            <p className="text-xs text-muted">
              Required by US law (COPPA) for every YouTube upload. &ldquo;Yes&rdquo; permanently turns
              off comments and personalized ads on the video.
            </p>
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
            <Toggle
              label="Paid partnership"
              checked={instagram.paidPartnership}
              onChange={(v) => setInstagram({ ...instagram, paidPartnership: v })}
            />
            {instagram.paidPartnership && (
              <>
                <input
                  value={instagram.sponsors}
                  onChange={(e) => setInstagram({ ...instagram, sponsors: e.target.value })}
                  placeholder="Sponsor's Instagram username (up to 2, optional)"
                  className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                />
                <p className="text-xs text-muted">
                  Shows Instagram&rsquo;s &ldquo;Paid partnership&rdquo; label. Needs the account connected with
                  Facebook login, and doesn&rsquo;t apply to Stories.
                </p>
              </>
            )}
          </Panel>
        )}
        {paidPartnership && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-surface-sub p-3 text-xs">
            <input
              type="checkbox"
              checked={adTagChoice}
              onChange={(e) => setAdTagChoice(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Start the caption with &ldquo;#ad&rdquo;.
              <span className="mt-0.5 block text-muted">
                A paid partnership has to be disclosed where people read it (FTC endorsement guides) --
                including on YouTube and LinkedIn, which have no partnership label here.
              </span>
            </span>
          </label>
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
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
