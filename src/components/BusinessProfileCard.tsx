"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * What "Mention your business" mentions -- read from the saved business quiz,
 * never asked for again here.
 *
 * With a profile: who it is and what they do, and a link to change it on the
 * Business page. Without one (the quiz was skipped): a button to take the
 * quiz. Both open in a new tab, so the video being configured here is still
 * here afterwards -- and this card is a live query, so it updates the moment
 * the quiz is finished in the other tab.
 */
export function BusinessProfileCard() {
  const brand = useQuery(api.brands.mine);

  if (brand === undefined) {
    return <p className="mt-2 text-xs text-muted">Loading your business profile…</p>;
  }

  // A skipped quiz leaves a row with a name and nothing to write from.
  if (!brand?.description) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
        <span aria-hidden className="text-lg">🏷️</span>
        <p className="min-w-0 flex-1 text-xs leading-snug">
          <span className="font-semibold">No business profile yet.</span> Take the two-minute
          quiz once and every video can mention your business.
        </p>
        <Link
          href="/onboarding?retake=1&from=editor"
          target="_blank"
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          Take the quiz ↗
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-start gap-3 rounded-lg border border-line bg-surface-sub px-3 py-2.5">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="size-8 shrink-0 rounded-md border border-line bg-surface object-contain p-0.5" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-white">
          {brand.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          Mentioning <span className="font-semibold">{brand.name}</span>
        </p>
        <p className="line-clamp-2 text-xs leading-snug text-muted">{brand.description}</p>
      </div>
      <Link
        href="/business"
        target="_blank"
        className="shrink-0 text-xs font-medium text-accent hover:underline"
      >
        Edit ↗
      </Link>
    </div>
  );
}
