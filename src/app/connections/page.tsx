"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AuthorisedBoundary } from "@/components/AuthorisedBoundary";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Where social accounts are connected.
 *
 * Tokens live at Zernio, never here -- this page only kicks off the OAuth
 * handoff and then reads back what Zernio says is connected.
 */
const PLATFORMS = [
  {
    id: "tiktok" as const,
    name: "TikTok",
    blurb: "Vertical video, 3s–10min",
    // Surfaced up front rather than at publish time, where it would be a
    // rejected post instead of a sentence.
    caveat: "Posting requires confirming TikTok's content preview and consent each time.",
  },
  {
    id: "instagram" as const,
    name: "Instagram",
    blurb: "Reels, feed video and Stories",
    caveat: "Requires a Business or Creator account — personal accounts cannot post via API.",
  },
  {
    id: "youtube" as const,
    name: "YouTube",
    blurb: "Shorts and long-form",
    caveat: "Unverified channels are capped at 15 minutes per upload.",
  },
  {
    id: "linkedin" as const,
    name: "LinkedIn",
    blurb: "Personal profile or company page",
    caveat: "Company pages need the organization selected after OAuth.",
  },
];

export default function ConnectionsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
      <p className="mt-1 text-sm text-muted">
        Connect the accounts you publish to. Format Engine never sees your passwords or tokens.
      </p>

      <AuthorisedBoundary>
        <Suspense fallback={null}>
          <ConnectionsBody />
        </Suspense>
      </AuthorisedBoundary>
    </main>
  );
}

function ConnectionsBody() {
  const params = useSearchParams();
  const justConnected = params.get("connected");
  // Zernio's own failure path -- oauth_denied, no_facebook_pages, and the
  // rest of the codes on GET /v1/connect/{platform} -- lands here too, with
  // `error` (and `platform`) appended instead of `connected`.
  const connectError = params.get("error");

  const configured = useQuery(api.social.configured);
  const accounts = useQuery(api.social.listAccounts);
  const startConnect = useAction(api.social.startConnect);
  const syncAccounts = useAction(api.social.syncAccounts);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A plain projection of the URL, not state that needs syncing in an
  // effect -- a click-to-connect failure (below) still wins once it happens.
  const displayError = error ?? (connectError ? `Zernio couldn't complete that connection: ${connectError}` : null);

  // Coming back from the platform's OAuth screen: Zernio has the account by
  // now, so pull the authoritative list rather than trusting the query string.
  useEffect(() => {
    if (justConnected) syncAccounts({}).catch(() => {});
  }, [justConnected, syncAccounts]);

  async function connect(platform: (typeof PLATFORMS)[number]["id"]) {
    setBusy(platform);
    setError(null);
    try {
      // Zernio needs an absolute URL to bounce the browser back to once the
      // platform's OAuth screen finishes -- without one it has nowhere to
      // send the user, and the flow dead-ends on Zernio's own side.
      const redirectUrl = `${window.location.origin}/connections`;
      const { authUrl } = await startConnect({ platform, redirectUrl });
      window.location.assign(authUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  if (configured === false) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-line bg-surface-sub p-4 text-sm text-muted">
        <p className="font-medium text-foreground">Zernio isn&rsquo;t configured yet</p>
        <p className="mt-1">
          Run <code className="font-mono text-xs">npx convex env set ZERNIO_API_KEY &lt;key&gt;</code>{" "}
          on this deployment, then reload.
        </p>
      </div>
    );
  }

  return (
    <>
      {displayError && <p className="mt-4 text-sm text-accent">{displayError}</p>}
      <ul className="mt-6 space-y-2">
        {PLATFORMS.map((platform) => {
          const connected = accounts?.filter((a) => a.platform === platform.id) ?? [];
          return (
            <li
              key={platform.id}
              className="rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{platform.name}</span>
                  <span className="block text-xs text-muted">{platform.blurb}</span>
                </span>
                <button
                  onClick={() => connect(platform.id)}
                  disabled={busy === platform.id}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {busy === platform.id
                    ? "Opening…"
                    : connected.length
                      ? "Connect another"
                      : "Connect"}
                </button>
              </div>

              {connected.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                  {connected.map((account) => (
                    <AccountRow key={account._id} id={account._id} username={account.username} />
                  ))}
                </ul>
              )}

              <p className="mt-2 text-xs text-muted">{platform.caveat}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AccountRow({ id, username }: { id: Id<"socialAccounts">; username: string }) {
  const disconnect = useAction(api.social.disconnect);
  const [busy, setBusy] = useState(false);

  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="min-w-0 flex-1 truncate">@{username}</span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await disconnect({ socialAccountId: id });
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
      >
        {busy ? "Disconnecting…" : "Disconnect"}
      </button>
    </li>
  );
}
