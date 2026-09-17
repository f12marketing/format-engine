import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";

/**
 * Per-client request-rate limits, layered on top of (not instead of) the
 * dollar spend cap in ledger.ts. That cap only fires once real money is
 * about to be spent, checked by re-reading a summed total on every call --
 * which does nothing to stop a tight retry loop or a leaked-token script
 * from firing hundreds of requests in the same second (several can all read
 * the same stale sum and pass the check before any of them commits), and
 * nothing at all for the one entry point here that spends no money
 * (`generateUploadUrl`). These limits are generous enough that no
 * legitimate use of this app should ever hit them.
 */
const rateLimiter = new RateLimiter(components.rateLimiter, {
  // run.generate is the single funnel every one of the 16 formats starts
  // through -- one job every 3s sustained, bursts up to 20.
  generateJob: { kind: "token bucket", rate: 20, period: MINUTE },
  // No fal call, no ledger check at all today -- nothing else bounds how
  // many upload URLs a client can mint.
  generateUploadUrl: { kind: "token bucket", rate: 60, period: MINUTE },
  // avatars.generate and influencers.generateFaceImage: the two "generate
  // one $0.05 portrait outside of any job" entry points, sharing a limit
  // since they're the same pattern and the same race against the cap check.
  generateFaceImage: { kind: "token bucket", rate: 10, period: MINUTE },
});

type LimitName = "generateJob" | "generateUploadUrl" | "generateFaceImage";

/** Throws the same plain, human-readable Error style as ledger.assertUnderCap. */
export async function enforceRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: LimitName,
  key: string,
): Promise<void> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, name, { key });
  if (!ok) {
    const seconds = Math.max(1, Math.ceil((retryAfter ?? 0) / 1000));
    throw new Error(
      `You're doing that too fast -- try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
    );
  }
}
