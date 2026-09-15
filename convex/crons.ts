import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Webhook backstops, both for the same reason: local dev never receives a
 * webhook at all, and even in production a delivery can be lost. See
 * influencers.ts's reconcileStuckTrainings and socialPosts.reconcileInFlight.
 */
const crons = cronJobs();

crons.interval(
  "reconcile stuck influencer trainings",
  { minutes: 30 },
  internal.influencers.reconcileStuckTrainings,
);

crons.interval(
  "reconcile in-flight social posts",
  { minutes: 15 },
  internal.socialPosts.reconcileInFlight,
);

/**
 * Keeps every client's `postAnalytics` rollup and per-post numbers fresh
 * without anyone having to ask. A short 2-day window per run -- wide enough
 * to catch a post crossing midnight, cheap enough to run hourly across every
 * connected client.
 */
crons.interval(
  "sync social analytics",
  { hours: 1 },
  internal.analytics.syncAllClients,
);

export default crons;
