import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * The one HTTP-reachable route this app has: fal's callback when an
 * influencer's LoRA training finishes. Everything else here talks to Convex
 * over its own client SDK, not raw HTTP.
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

export default http;
