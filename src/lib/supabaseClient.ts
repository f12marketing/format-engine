import { createBrowserClient } from "@supabase/ssr";

/**
 * One client per tab, not per component -- `createBrowserClient` is meant to
 * be called once and shared, since it owns the auth listener and the token
 * refresh timer.
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createBrowserClient(url, key);
  return client;
}

export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
