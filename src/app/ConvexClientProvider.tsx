"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/nextjs";

/**
 * Convex reads the Clerk token, so authorisation lives in one place: a Convex
 * function asks `ctx.auth` who is calling and looks them up in `clients`. The
 * frontend never decides what someone may do.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Reported separately so the UI can name what is actually missing, and so the
 * two services can be configured in either order.
 */
export const convexConfigured = Boolean(convexUrl);
export const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
export const backendConfigured = convexConfigured && clerkConfigured;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Nothing configured: the picker, config panels and cost estimates still
  // work, so render the app rather than an error.
  if (!convex) return <>{children}</>;

  /**
   * Convex without Clerk still gets a client.
   *
   * Gating the provider on *both* meant any component calling useQuery or
   * useMutation threw "Could not find Convex client" the moment Convex was up
   * and Clerk was not -- which took down the whole editor page. Auth-scoped
   * functions will fail with a clear "Not authorised", which is the honest
   * outcome; a crashed route is not.
   */
  if (!clerkConfigured) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
