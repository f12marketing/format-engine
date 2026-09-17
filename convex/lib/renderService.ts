/**
 * Base URL and auth headers for every call into the sibling render-service.
 *
 * Consolidated here because the same env-var lookup was copy-pasted into 16
 * files. render-service is a public HTTP endpoint (Railway) with nothing else
 * in front of it -- no platform-level auth, no private networking between it
 * and Convex -- so an unauthenticated request would let anyone who finds the
 * URL use it as a free compute/SSRF proxy (it fetches whatever `videoUrl` /
 * `imageUrls` / etc. a caller supplies, server-side). RENDER_SERVICE_API_KEY
 * closes that: the service now fails closed (401) on every route but
 * `/health` when the key is missing or wrong, same "refuse rather than accept
 * unverifiable" rule already used for the Zernio webhook secret.
 */
export function renderServiceBase(): string {
  const base = (process.env.RENDER_SERVICE_URL ?? "").trim();
  if (!base) {
    throw new Error(
      "RENDER_SERVICE_URL is not set. Start ../render-service and run: " +
        "npx convex env set RENDER_SERVICE_URL http://localhost:4000",
    );
  }
  return base;
}

export function renderServiceHeaders(): Record<string, string> {
  const key = (process.env.RENDER_SERVICE_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "RENDER_SERVICE_API_KEY is not set on this deployment. Run: " +
        "npx convex env set RENDER_SERVICE_API_KEY <the same value the render service has>",
    );
  }
  return { "Content-Type": "application/json", "X-Render-Key": key };
}
