"use client";

import { ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

interface Props {
  children: ReactNode;
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
 */
export function AuthorisedBoundary({ children }: Props) {
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
