"use client";

/**
 * The one statement a client makes before a real person's photo is animated,
 * lip-synced or trained into an influencer. Ticking it is recorded on the
 * photo (`likenessConsentAt`), and the server refuses a job or influencer
 * that would use a photo without it -- see convex/lib/likeness.ts.
 */
export function LikenessConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-accent bg-accent-soft p-3 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        I have permission from the person in the photo to use their face in AI-generated videos
        and ads. Photos of people who haven&apos;t agreed -- celebrities, customers, anyone from
        social media -- can&apos;t be used.
        <span className="mt-1 block text-muted">
          To make the video, the photo is sent to our AI video provider (fal.ai), which runs the
          models on it.
        </span>
      </span>
    </label>
  );
}
