import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * The HTTP-reachable routes: fal's callback when an influencer's LoRA
 * training finishes, and Zernio's post-status events. Everything else here
 * talks to Convex over its own client SDK, not raw HTTP.
 *
 * httpActions run in the V8 isolate, same as queries and mutations -- no
 * Node.js APIs, which rules out doing the Ed25519 signature check inline
 * here. It's delegated to lib/falWebhook.ts's "use node" action instead;
 * this handler's own job is just plumbing: read the raw body (needed as
 * exact bytes for the signature hash, before any JSON parsing), pull the
 * four `X-Fal-Webhook-*` headers, and act on the verified result.
 */
const http = httpRouter();

http.route({
  path: "/fal/training-complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const requestId = request.headers.get("X-Fal-Webhook-Request-Id");
    const userId = request.headers.get("X-Fal-Webhook-User-Id");
    const timestamp = request.headers.get("X-Fal-Webhook-Timestamp");
    const signatureHex = request.headers.get("X-Fal-Webhook-Signature");
    if (!requestId || !userId || !timestamp || !signatureHex) {
      return new Response("missing webhook headers", { status: 400 });
    }

    const verified = await ctx.runAction(internal.lib.falWebhook.verifySignature, {
      requestId,
      userId,
      timestamp,
      signatureHex,
      rawBody,
    });
    // An unverified request is rejected outright -- this endpoint is public
    // by construction, so skipping this is the difference between "fal told
    // us training finished" and "anyone can mark any training ready with a
    // LoRA URL of their choosing."
    if (!verified) {
      return new Response("invalid signature", { status: 401 });
    }

    let payload: { request_id?: string; status?: string; payload?: unknown; error?: unknown };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("invalid JSON body", { status: 400 });
    }
    if (!payload.request_id || !payload.status) {
      return new Response("missing request_id or status", { status: 400 });
    }

    await ctx.runMutation(internal.influencers.handleTrainingWebhook, {
      falRequestId: payload.request_id,
      status: payload.status === "OK" ? "OK" : "ERROR",
      result: payload.payload,
      error: payload.error ? JSON.stringify(payload.error) : undefined,
    });

    // fal retries non-2xx up to 31 times with backoff -- once handled (even
    // a no-op for an already-settled or unknown request), 200 stops that.
    return new Response(null, { status: 200 });
  }),
});

/**
 * Zernio's post lifecycle events.
 *
 * Verified inline rather than in a `"use node"` action like fal's: Zernio
 * signs with HMAC-SHA256, which Web Crypto does in the V8 isolate, so there
 * is no reason to hop runtimes the way `lib/falWebhook.ts` has to for Ed25519.
 *
 * Zernio gives this endpoint 5 seconds before it counts the delivery as
 * failed and starts its seven retries, so the handler verifies, records, and
 * returns -- anything slower than a single mutation belongs on the scheduler.
 */
http.route({
  path: "/zernio/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Raw bytes, before any JSON parsing: the signature is over exactly what
    // was sent, and a re-serialised object is not that.
    const rawBody = await request.text();
    const signature = request.headers.get("X-Zernio-Signature");
    const event = request.headers.get("X-Zernio-Event");
    const eventId = request.headers.get("X-Zernio-Event-Id");

    if (!signature || !event || !eventId) {
      return new Response("missing webhook headers", { status: 400 });
    }

    const secret = (process.env.ZERNIO_WEBHOOK_SECRET ?? "").trim();
    if (!secret) {
      // Refuse rather than accept unverifiable events: this endpoint is
      // public by construction, so an unset secret would mean anyone could
      // mark any post published.
      return new Response("webhook secret not configured", { status: 503 });
    }

    const expected = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(expected, signature.trim().toLowerCase())) {
      return new Response("invalid signature", { status: 401 });
    }

    let payload: { id?: string; event?: string; post?: Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("invalid JSON body", { status: 400 });
    }

    await ctx.runMutation(internal.socialPosts.applyWebhookEvent, {
      eventId,
      event,
      payload: payload.post ?? {},
    });

    return new Response(null, { status: 200 });
  }),
});

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare, so a wrong signature can't be found byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
