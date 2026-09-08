import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * One job so far: influencer training's webhook backstop. See
 * influencers.ts's reconcileStuckTrainings for why this exists at all --
 * local dev never receives the webhook, and even in production a delivery
 * can be lost.
 */
const crons = cronJobs();

crons.interval(
  "reconcile stuck influencer trainings",
  { minutes: 30 },
  internal.influencers.reconcileStuckTrainings,
);

export default crons;
