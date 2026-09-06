"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getSupabaseClient } from "@/lib/supabaseClient";

/**
 * Signed-in identity, and the owner bootstrap.
 *
 * `clients:bootstrapFirstClient` only ever creates a row when the table is
 * empty, so calling it here on every sign-in is safe -- it either admits you
 * (the first signed-in person, ever) or does nothing, because you already
 * have a row or someone else does.
 */
export function AuthStatus() {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.clients.me, isAuthenticated ? {} : "skip");
  const bootstrap = useMutation(api.clients.bootstrapFirstClient);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (isAuthenticated && me === null && !bootstrapped) {
      setBootstrapped(true);
      bootstrap({}).catch(() => {
        // Not the first sign-in -- someone else already owns this deployment.
        // clients.me staying null is the correct, visible state for that.
      });
    }
  }, [isAuthenticated, me, bootstrapped, bootstrap]);

  if (!isAuthenticated) {
    return (
      <a href="/sign-in" className="text-sm text-accent hover:opacity-80">
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">{me?.displayName ?? "…"}</span>
      <button
        onClick={() => getSupabaseClient()?.auth.signOut()}
        className="text-muted hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
