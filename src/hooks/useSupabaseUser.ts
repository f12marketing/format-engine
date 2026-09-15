"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabaseClient";

/**
 * The signed-in Supabase user, for code that talks to Postgres directly
 * (RLS-scoped tables) rather than through Convex -- `useConvexAuth` only
 * knows whether a token was handed to Convex, not whose `auth.uid()` it is.
 */
export function useSupabaseUser() {
  const [user, setUser] = useState<User | null>(null);
  // Lazy initializer, not an effect -- whether Supabase is configured at all
  // is known synchronously, so there's nothing to "load" in that case.
  const [isLoading, setIsLoading] = useState(() => Boolean(getSupabaseClient()));

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUser(session?.user ?? null);
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, isLoading };
}
