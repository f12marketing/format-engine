import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the exported function from
 * `middleware` to `proxy`. The edge runtime isn't supported here -- the runtime
 * is nodejs and not configurable -- so a Next 15 Clerk snippet dropped in
 * unchanged will not work.
 *
 * Everything but the sign-in routes is protected, because an invite-only tool
 * has no public surface to leave open.
 */
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/**
 * Until the keys exist, pass everything through untouched.
 *
 * `clerkMiddleware()` throws on a missing publishable key, and an unguarded
 * import here would take down the picker and the editor -- which work fine
 * without a backend and are most of what there currently is to look at. The
 * moment both keys are set this flips to real protection with no code change.
 */
export const proxy = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublic(req)) await auth.protect();
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they carry a
    // query string.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
