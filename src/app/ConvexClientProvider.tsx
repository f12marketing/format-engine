"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { supabaseConfigured } from "@/lib/supabaseClient";

/**
 * Convex reads the Supabase-issued JWT, so authorisation lives in one place: a
 * Convex function asks `ctx.auth` who is calling and looks them up in
 * `clients`. The frontend never decides what someone may do.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Reported separately so the UI can name what is actually missing, and so the
 * two services can be configured in either order.
 */
export const convexConfigured = Boolean(convexUrl);
export const authConfigured = supabaseConfigured;
export const backendConfigured = convexConfigured && authConfigured;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Nothing configured: the picker, config panels and cost estimates still
  // work, so render the app rather than an error.
  if (!convex) return <>{children}</>;

  /**
   * Convex without Supabase still gets a client.
   *
   * Gating the provider on both meant any component calling useQuery or
   * useMutation would throw "Could not find Convex client" the moment Convex
   * was up and auth was not -- which took down the whole editor page in an
   * earlier version of this file. Auth-scoped functions fail with a readable
   * "Not authorised" instead, which is the honest outcome; a crashed route is
   * not.
   */
  if (!authConfigured) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useSupabaseAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
