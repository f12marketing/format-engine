"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabaseClient";

/**
 * The contract ConvexProviderWithAuth needs, implemented against Supabase
 * instead of Clerk or Auth0 -- Convex's generic auth integration is exactly
 * for providers without a dedicated `convex/react-*` package.
 *
 * `fetchAccessToken` is called by Convex itself whenever it needs a token,
 * including on reconnect after a network blip, so it must return a *live*
 * session's token rather than one captured at mount time -- hence reading
 * from `supabase.auth.getSession()` on every call rather than from state.
 */
export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        setSession(data.session);
        setIsLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, s: Session | null) => {
        setSession(s);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      const supabase = getSupabaseClient();
      if (!supabase) return null;
      // A forced refresh matters right after sign-in: the session that
      // triggered onAuthStateChange can still be carrying the previous
      // (or no) token for a moment.
      const { data } = forceRefreshToken
        ? await supabase.auth.refreshSession()
        : await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    [],
  );

  return {
    isLoading,
    isAuthenticated: session !== null,
    fetchAccessToken,
  };
}
