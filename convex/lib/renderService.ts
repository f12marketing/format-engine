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

/**
 * Refuses to start a video whose render service would drop its voiceover.
 *
 * Slideshow and Video Animation are cut to one continuous voiceover, which the
 * render service lays across the finished cut. A service still running older
 * code does not know the `voiceoverUrl` field: it ignores it and returns a
 * perfectly good-looking video with no voice in it. Nothing errors, and by then
 * the images have been paid for. So the first step of each format asks the
 * service what it supports -- `/health` needs no key and returns `voiceover`
 * from the versions that understand it -- and stops here, before any spend.
 */
export async function assertVoiceoverSupport(): Promise<void> {
  const base = renderServiceBase();
  let health: { voiceover?: boolean } | null = null;
  try {
    const res = await fetch(`${base}/health`);
    health = res.ok ? ((await res.json()) as { voiceover?: boolean }) : null;
  } catch {
    // Handled below: unreachable reads the same as unable to say.
  }
  if (!health) {
    throw new Error(
      `Could not reach the render service at ${base}. Start it (cd ../render-service && npm start) ` +
        "and generate again.",
    );
  }
  if (health.voiceover !== true) {
    throw new Error(
      "The render service is running old code that would leave the voiceover out of the video. " +
        "Restart it (cd ../render-service && npm start) and generate again.",
    );
  }
}
