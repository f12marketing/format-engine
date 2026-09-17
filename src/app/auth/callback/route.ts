import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "@/lib/safeRedirect";

/**
 * Where the magic link lands.
 *
 * Supabase's PKCE flow puts a one-time `code` in the query string; exchanging
 * it for a session has to happen server-side, in something with cookie write
 * access, which a Client Component does not have. A Route Handler is the
 * smallest thing that qualifies.
 *
 * `cookies()` is async in Next 16 -- synchronous access to it was removed,
 * not merely deprecated.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
