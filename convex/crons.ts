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

/**
 * Image Slideshow's photo search cache: Pixabay's terms ask for searches to be
 * cached for 24 hours, and nothing needs one longer than that.
 */
crons.interval("prune photo search cache", { hours: 24 }, internal.imageSets.pruneSearchCache);

/**
 * Deletes Image Slideshow exports and never-used searched photos older than
 * 90 days -- see retention.ts for what is protected and why.
 */
crons.interval("expire old slideshow files", { hours: 24 }, internal.retention.run, {});

export default crons;
