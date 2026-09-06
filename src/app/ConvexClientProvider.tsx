"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/nextjs";

/**
 * Convex reads the Clerk token, so authorisation lives in one place: a Convex
 * function asks `ctx.auth` who is calling and looks them up in `clients`. The
 * frontend never decides what someone may do.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Before `npx convex dev` has run there is no deployment to talk to. Render
  // the app anyway rather than crashing -- the picker, the config panel and the
  // live cost estimate all work without a backend, and that is most of what
  // there is to look at right now.
  if (!convex || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

/**
 * Reported separately so the dashboard can name what is actually missing.
 * "Backend not connected" when Convex is up and only Clerk is absent sends you
 * to re-run a command that already succeeded.
 */
export const convexConfigured = Boolean(convexUrl);
export const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
export const backendConfigured = convexConfigured && clerkConfigured;
