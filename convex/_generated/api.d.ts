/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiNewsAnchor from "../aiNewsAnchor.js";
import type * as analytics from "../analytics.js";
import type * as assets from "../assets.js";
import type * as audio from "../audio.js";
import type * as avatars from "../avatars.js";
import type * as brands from "../brands.js";
import type * as carousel from "../carousel.js";
import type * as characterSwap from "../characterSwap.js";
import type * as claymation from "../claymation.js";
import type * as clients from "../clients.js";
import type * as clips from "../clips.js";
import type * as crons from "../crons.js";
import type * as custom from "../custom.js";
import type * as cuttingFruit from "../cuttingFruit.js";
import type * as dev from "../dev.js";
import type * as drama from "../drama.js";
import type * as felt from "../felt.js";
import type * as galleryFaces from "../galleryFaces.js";
import type * as greenScreenMeme from "../greenScreenMeme.js";
import type * as greenScreenMobile from "../greenScreenMobile.js";
import type * as http from "../http.js";
import type * as imageSets from "../imageSets.js";
import type * as imageSlideshow from "../imageSlideshow.js";
import type * as influencers from "../influencers.js";
import type * as jobs from "../jobs.js";
import type * as ledger from "../ledger.js";
import type * as lego from "../lego.js";
import type * as lib_animateScenePrimitive from "../lib/animateScenePrimitive.js";
import type * as lib_audioRef from "../lib/audioRef.js";
import type * as lib_avatarPrimitive from "../lib/avatarPrimitive.js";
import type * as lib_businessContext from "../lib/businessContext.js";
import type * as lib_businessQuiz from "../lib/businessQuiz.js";
import type * as lib_carouselPrompt from "../lib/carouselPrompt.js";
import type * as lib_carouselTemplates from "../lib/carouselTemplates.js";
import type * as lib_clayScenePrimitive from "../lib/clayScenePrimitive.js";
import type * as lib_clipIngest from "../lib/clipIngest.js";
import type * as lib_extras from "../lib/extras.js";
import type * as lib_facePrompt from "../lib/facePrompt.js";
import type * as lib_fal from "../lib/fal.js";
import type * as lib_falWebhook from "../lib/falWebhook.js";
import type * as lib_grounding from "../lib/grounding.js";
import type * as lib_imageSets from "../lib/imageSets.js";
import type * as lib_imageSlideshowDesign from "../lib/imageSlideshowDesign.js";
import type * as lib_imageSlideshowTemplates from "../lib/imageSlideshowTemplates.js";
import type * as lib_klingClip from "../lib/klingClip.js";
import type * as lib_musicMoods from "../lib/musicMoods.js";
import type * as lib_narratedClipPrimitive from "../lib/narratedClipPrimitive.js";
import type * as lib_narrationPrimitive from "../lib/narrationPrimitive.js";
import type * as lib_nodeStorage from "../lib/nodeStorage.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_renderService from "../lib/renderService.js";
import type * as lib_roster from "../lib/roster.js";
import type * as lib_scriptPrimitive from "../lib/scriptPrimitive.js";
import type * as lib_scriptTiming from "../lib/scriptTiming.js";
import type * as lib_scriptVoice from "../lib/scriptVoice.js";
import type * as lib_speechPrimitive from "../lib/speechPrimitive.js";
import type * as lib_videoRef from "../lib/videoRef.js";
import type * as lib_voiceSample from "../lib/voiceSample.js";
import type * as lib_wallOfTextDesign from "../lib/wallOfTextDesign.js";
import type * as lib_wordBudget from "../lib/wordBudget.js";
import type * as lib_zernio from "../lib/zernio.js";
import type * as music from "../music.js";
import type * as netflixDocumentary from "../netflixDocumentary.js";
import type * as onAWalk from "../onAWalk.js";
import type * as onboarding from "../onboarding.js";
import type * as productSpokesperson from "../productSpokesperson.js";
import type * as remix from "../remix.js";
import type * as retention from "../retention.js";
import type * as run from "../run.js";
import type * as skeleton from "../skeleton.js";
import type * as slideshow from "../slideshow.js";
import type * as social from "../social.js";
import type * as socialPosts from "../socialPosts.js";
import type * as speakingHookDemo from "../speakingHookDemo.js";
import type * as starters from "../starters.js";
import type * as streetInterview from "../streetInterview.js";
import type * as talkingHeadGreenScreen from "../talkingHeadGreenScreen.js";
import type * as talkingHeadUgc from "../talkingHeadUgc.js";
import type * as talkingObjects from "../talkingObjects.js";
import type * as uploads from "../uploads.js";
import type * as videoAnimation from "../videoAnimation.js";
import type * as videoHookDemo from "../videoHookDemo.js";
import type * as voicePreview from "../voicePreview.js";
import type * as wallOfText from "../wallOfText.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiNewsAnchor: typeof aiNewsAnchor;
  analytics: typeof analytics;
  assets: typeof assets;
  audio: typeof audio;
  avatars: typeof avatars;
  brands: typeof brands;
  carousel: typeof carousel;
  characterSwap: typeof characterSwap;
  claymation: typeof claymation;
  clients: typeof clients;
  clips: typeof clips;
  crons: typeof crons;
  custom: typeof custom;
  cuttingFruit: typeof cuttingFruit;
  dev: typeof dev;
  drama: typeof drama;
  felt: typeof felt;
  galleryFaces: typeof galleryFaces;
  greenScreenMeme: typeof greenScreenMeme;
  greenScreenMobile: typeof greenScreenMobile;
  http: typeof http;
  imageSets: typeof imageSets;
  imageSlideshow: typeof imageSlideshow;
  influencers: typeof influencers;
  jobs: typeof jobs;
  ledger: typeof ledger;
  lego: typeof lego;
  "lib/animateScenePrimitive": typeof lib_animateScenePrimitive;
  "lib/audioRef": typeof lib_audioRef;
  "lib/avatarPrimitive": typeof lib_avatarPrimitive;
  "lib/businessContext": typeof lib_businessContext;
  "lib/businessQuiz": typeof lib_businessQuiz;
  "lib/carouselPrompt": typeof lib_carouselPrompt;
  "lib/carouselTemplates": typeof lib_carouselTemplates;
  "lib/clayScenePrimitive": typeof lib_clayScenePrimitive;
  "lib/clipIngest": typeof lib_clipIngest;
  "lib/extras": typeof lib_extras;
  "lib/facePrompt": typeof lib_facePrompt;
  "lib/fal": typeof lib_fal;
  "lib/falWebhook": typeof lib_falWebhook;
  "lib/grounding": typeof lib_grounding;
  "lib/imageSets": typeof lib_imageSets;
  "lib/imageSlideshowDesign": typeof lib_imageSlideshowDesign;
  "lib/imageSlideshowTemplates": typeof lib_imageSlideshowTemplates;
  "lib/klingClip": typeof lib_klingClip;
  "lib/musicMoods": typeof lib_musicMoods;
  "lib/narratedClipPrimitive": typeof lib_narratedClipPrimitive;
  "lib/narrationPrimitive": typeof lib_narrationPrimitive;
  "lib/nodeStorage": typeof lib_nodeStorage;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/renderService": typeof lib_renderService;
  "lib/roster": typeof lib_roster;
  "lib/scriptPrimitive": typeof lib_scriptPrimitive;
  "lib/scriptTiming": typeof lib_scriptTiming;
  "lib/scriptVoice": typeof lib_scriptVoice;
  "lib/speechPrimitive": typeof lib_speechPrimitive;
  "lib/videoRef": typeof lib_videoRef;
  "lib/voiceSample": typeof lib_voiceSample;
  "lib/wallOfTextDesign": typeof lib_wallOfTextDesign;
  "lib/wordBudget": typeof lib_wordBudget;
  "lib/zernio": typeof lib_zernio;
  music: typeof music;
  netflixDocumentary: typeof netflixDocumentary;
  onAWalk: typeof onAWalk;
  onboarding: typeof onboarding;
  productSpokesperson: typeof productSpokesperson;
  remix: typeof remix;
  retention: typeof retention;
  run: typeof run;
  skeleton: typeof skeleton;
  slideshow: typeof slideshow;
  social: typeof social;
  socialPosts: typeof socialPosts;
  speakingHookDemo: typeof speakingHookDemo;
  starters: typeof starters;
  streetInterview: typeof streetInterview;
  talkingHeadGreenScreen: typeof talkingHeadGreenScreen;
  talkingHeadUgc: typeof talkingHeadUgc;
  talkingObjects: typeof talkingObjects;
  uploads: typeof uploads;
  videoAnimation: typeof videoAnimation;
  videoHookDemo: typeof videoHookDemo;
  voicePreview: typeof voicePreview;
  wallOfText: typeof wallOfText;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
