import { internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";

/**
 * One line per runnable format, plus its workflow's `start` mutation.
 *
 * Shared by `run.generate` (the Generate button), `remix.remix` and
 * `dev.startJob`/`dev.startJob`-alikes -- three different entry points into
 * the same set of pipelines. It used to be copied into each one separately;
 * a third copy is exactly the point where "add a format, remember to update
 * three lists" stops being a reasonable thing to ask of future edits.
 *
 * The `Starter` type is spelled out with `FunctionReference` rather than
 * `typeof internal.carousel.start`: this file has no query/mutation/action of
 * its own, but `_generated/api`'s internal namespace still walks every module
 * under convex/, including this one -- so a type inferred FROM `internal`
 * here depends on `internal`, which depends on this module's own shape. That
 * is a genuine cycle (TS2502/TS7022), not just an inference gap; only a type
 * that doesn't route back through `internal` breaks it.
 */
type Starter = FunctionReference<
  "mutation",
  "internal",
  { jobId: Id<"jobs">; clientId: Id<"clients"> },
  string
>;

export const STARTERS: Record<string, Starter> = {
  carousel: internal.carousel.start,
  custom: internal.custom.start,
  "wall-of-text": internal.wallOfText.start,
  slideshow: internal.slideshow.start,
  "video-animation": internal.videoAnimation.start,
  drama: internal.drama.start,
  "video-hook-demo": internal.videoHookDemo.start,
  "green-screen-meme": internal.greenScreenMeme.start,
  "talking-head-ugc": internal.talkingHeadUgc.start,
  "speaking-hook-demo": internal.speakingHookDemo.start,
  "talking-head-green-screen": internal.talkingHeadGreenScreen.start,
  "product-spokesperson": internal.productSpokesperson.start,
  "green-screen-mobile": internal.greenScreenMobile.start,
  "cutting-fruit": internal.cuttingFruit.start,
  "on-a-walk": internal.onAWalk.start,
  "netflix-documentary": internal.netflixDocumentary.start,
  claymation: internal.claymation.start,
  skeleton: internal.skeleton.start,
  "character-swap": internal.characterSwap.start,
  lego: internal.lego.start,
  felt: internal.felt.start,
  "talking-objects": internal.talkingObjects.start,
  "street-interview": internal.streetInterview.start,
  "ai-news-anchor": internal.aiNewsAnchor.start,
};

export type RunnableFormatId =
  | "carousel"
  | "custom"
  | "wall-of-text"
  | "slideshow"
  | "video-animation"
  | "drama"
  | "video-hook-demo"
  | "green-screen-meme"
  | "talking-head-ugc"
  | "speaking-hook-demo"
  | "talking-head-green-screen"
  | "product-spokesperson"
  | "green-screen-mobile"
  | "cutting-fruit"
  | "on-a-walk"
  | "netflix-documentary"
  | "claymation"
  | "skeleton"
  | "character-swap"
  | "lego"
  | "felt"
  | "talking-objects"
  | "street-interview"
  | "ai-news-anchor";
