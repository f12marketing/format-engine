import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the exported function from
 * `middleware` to `proxy`. The edge runtime isn't supported here -- the
 * runtime is nodejs and not configurable.
 *
 * Supabase's session lives in cookies, and its access token expires in about
 * an hour, so every request needs a chance to silently refresh it before a
 * Server Component reads a stale one. `getUser()` (not `getSession()`) is
 * what actually contacts Supabase to validate the token -- `getSession()`
 * only reads the local cookie and would happily return a token that's already
 * been revoked.
 */
const PUBLIC_PATHS = ["/sign-in", "/auth/callback"];

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export async function proxy(request: NextRequest) {
  // Until both env vars exist, pass everything through untouched -- same
  // reasoning as ConvexClientProvider: an invite-only tool with no way to
  // sign in yet should still let you look at the picker and config panels.
  if (!supabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          // Cookies set here must land on both the request (so this same pass
          // sees the refreshed session) and the response (so the browser does).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless they carry a
    // query string.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
