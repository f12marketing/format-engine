"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";

/**
 * Verifying fal's webhook signature needs real Ed25519 verification, which
 * plain V8-runtime Convex functions (httpAction included -- see http.ts's own
 * comment) cannot do; Node's `crypto` can. This is the one file in the split
 * that needs "use node", called by http.ts's handler rather than doing the
 * crypto inline there.
 *
 * Algorithm is fal's own, verbatim (fal.ai/docs/model-endpoints/webhooks):
 * message = `${requestId}\n${userId}\n${timestamp}\n${sha256Hex(rawBody)}`,
 * verified against every key in fal's JWKS until one succeeds.
 */
const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const TIMESTAMP_TOLERANCE_SEC = 300;

interface Jwk {
  x: string;
}

function base64UrlToBuffer(b64url: string): Buffer {
  const padded = b64url + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Node's crypto wants a full SPKI-wrapped key, not the bare 32-byte Ed25519
 * point JWKS hands back -- this is RFC 8410's fixed 12-byte SPKI header for
 * Ed25519, prepended to the raw key rather than parsed from anything.
 */
function ed25519PublicKeyFromRaw(rawKey: Buffer) {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([spkiPrefix, rawKey]), format: "der", type: "spki" });
}

export const verifySignature = internalAction({
  args: {
    requestId: v.string(),
    userId: v.string(),
    timestamp: v.string(),
    signatureHex: v.string(),
    rawBody: v.string(),
  },
  handler: async (
    _ctx,
    { requestId, userId, timestamp, signatureHex, rawBody },
  ): Promise<boolean> => {
    const now = Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SEC) {
      return false;
    }

    const bodyHashHex = createHash("sha256").update(rawBody, "utf8").digest("hex");
    const message = Buffer.from(`${requestId}\n${userId}\n${timestamp}\n${bodyHashHex}`, "utf8");
    const signature = Buffer.from(signatureHex, "hex");

    const jwksRes = await fetch(JWKS_URL);
    if (!jwksRes.ok) throw new Error(`could not fetch fal's JWKS: ${jwksRes.status}`);
    const { keys } = (await jwksRes.json()) as { keys: Jwk[] };

    for (const key of keys) {
      try {
        const publicKey = ed25519PublicKeyFromRaw(base64UrlToBuffer(key.x));
        if (verifyEd25519(null, message, publicKey, signature)) return true;
      } catch {
        // Malformed key or a mismatched one -- try the rest before giving up.
      }
    }
    return false;
  },
});
