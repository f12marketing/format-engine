import path from "node:path";
import type { NextConfig } from "next";

/**
 * The only origins the browser legitimately talks to: itself, Convex
 * (storage URLs, the realtime websocket) and Supabase Auth. Matched by
 * pattern rather than reading NEXT_PUBLIC_CONVEX_URL/NEXT_PUBLIC_SUPABASE_URL
 * here -- next.config.ts's own env-loading timing isn't guaranteed the way a
 * request handler's is, and a CSP that silently lost its connect-src entries
 * would break the app rather than just being slightly too permissive.
 * *.convex.cloud and *.supabase.co cover every real deployment; the two
 * localhost entries cover this project's own local-dev convention (see
 * convex/lib/renderService.ts and every format's RENDER_SERVICE_URL check).
 */
const CONVEX_ORIGINS = "https://*.convex.cloud http://127.0.0.1:3210";
const CONVEX_WS_ORIGINS = "wss://*.convex.cloud ws://127.0.0.1:3210";
const SUPABASE_ORIGINS = "https://*.supabase.co";
// Where fal serves the files its models return. Media only, and only for the
// voice preview's <audio>, which plays the sample straight from the URL fal
// hands back rather than copying it into Convex storage -- a copy per click
// would be a file that is never cleaned up. Sharded (v3.fal.media,
// v3b.fal.media, ...), hence the wildcard.
const FAL_MEDIA_ORIGINS = "https://*.fal.media";
// The music popup previews Platform tracks straight from Freesound's CDN --
// the file is only copied into Convex storage once a track is picked.
const FREESOUND_MEDIA_ORIGINS = "https://cdn.freesound.org";
// Wall of Text's studio previews text in the Google Font the render will use:
// the stylesheet from fonts.googleapis.com, the font files from gstatic.
// Green Screen Meme's meme popup talks to Klipy straight from the browser, as
// Klipy's rules require, and shows its media straight from Klipy's CDN
// (static.klipy.com, static1..., static2...) -- never copied or proxied.
const KLIPY_API = "https://api.klipy.com";
const KLIPY_MEDIA = "https://*.klipy.com";
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

// React's dev-mode debugging (reconstructing stack traces across Turbopack's
// eval-based module wrapping) calls eval() -- "React will never use eval()
// in production mode" per its own warning, so this is scoped to dev only
// rather than weakening the real CSP.
const SCRIPT_SRC =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  // Next.js ships inline bootstrap/hydration scripts with no nonce
  // infrastructure in this app, so 'unsafe-inline' is the pragmatic floor --
  // still blocks the common case of a remote <script src> being injected.
  SCRIPT_SRC,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
  `img-src 'self' data: blob: ${CONVEX_ORIGINS} ${KLIPY_MEDIA}`,
  `media-src 'self' blob: ${CONVEX_ORIGINS} ${FAL_MEDIA_ORIGINS} ${FREESOUND_MEDIA_ORIGINS} ${KLIPY_MEDIA}`,
  `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
  `connect-src 'self' ${CONVEX_ORIGINS} ${CONVEX_WS_ORIGINS} ${SUPABASE_ORIGINS} ${KLIPY_API}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    /**
     * Pin the workspace root. Without this, Turbopack walks up past the repo
     * and finds an unrelated pnpm-lock.yaml in the home directory, then warns
     * on every start about ignoring it.
     */
    root: path.resolve(import.meta.dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          // Belt-and-braces alongside frame-ancestors above: an older browser
          // that ignores CSP's frame-ancestors still respects this.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No-op over plain http (which local dev always is), so this is
          // safe to always send rather than branching on environment.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
