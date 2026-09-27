"use client";

import { ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  authConfigured,
  backendConfigured,
  convexConfigured,
} from "@/app/ConvexClientProvider";

interface Props {
  children: ReactNode;
  /**
   * Shown instead when Convex or Supabase Auth isn't configured. Defaults to
   * a page-level notice; a single form field passes something smaller.
   */
  unconfigured?: ReactNode;
}

/**
 * Gates `children` behind a confirmed, admitted client -- rather than
 * catching the "Not authorised" error an auth-scoped query (`jobs.list`,
 * `avatars.list`, ...) throws for anyone else. An error boundary can turn
 * that throw into a readable fallback, but React still reports a
 * boundary-caught error to the console, which Next's dev overlay shows as a
 * full "Runtime Error" screen regardless -- so the fix is to never make the
 * throwing call at all. `clients.me` is the one query here that's always
 * safe to call: it returns `null` for "not a client" instead of throwing.
 *
 * The same applies one level up: `useConvexAuth` throws unless
 * ConvexProviderWithAuth is mounted, which ConvexClientProvider only does
 * when both services are configured. So check that first, and only mount the
 * hooks once there's something to ask.
 */
export function AuthorisedBoundary({ children, unconfigured }: Props) {
  // Module-level constants, so this branch never flips between renders.
  if (!backendConfigured) {
    const missing = [!convexConfigured && "Convex", !authConfigured && "Supabase Auth"]
      .filter(Boolean)
      .join(" and ");
    return (
      unconfigured ?? (
        <div className="mt-2 rounded-xl border border-dashed border-line p-6 text-sm text-muted">
          <p className="font-medium text-foreground">Sign-in isn&rsquo;t set up yet.</p>
          <p className="mt-1">Needs {missing} -- see the README.</p>
        </div>
      )
    );
  }

  return <AdmittedGate>{children}</AdmittedGate>;
}

function AdmittedGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.clients.me, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <div className="mt-2 rounded-xl border border-line p-6 text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-line p-6 text-sm text-muted">
        <p className="font-medium text-foreground">Sign in to see this.</p>
        <p className="mt-1">
          <a href="/sign-in" className="text-accent hover:opacity-80">
            Sign in
          </a>{" "}
          -- jobs are scoped to a signed-in, admitted client.
        </p>
      </div>
    );
  }

  if (!me || me.archived) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-line p-6 text-sm text-muted">
        <p className="font-medium text-foreground">
          {me?.archived
            ? "This account has been archived."
            : "This account hasn't been invited."}
        </p>
        <p className="mt-1">Ask the owner to add you from the Convex dashboard.</p>
      </div>
    );
  }

  return <>{children}</>;
}
