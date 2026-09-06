/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as carousel from "../carousel.js";
import type * as clients from "../clients.js";
import type * as dev from "../dev.js";
import type * as jobs from "../jobs.js";
import type * as ledger from "../ledger.js";
import type * as lib_carouselPrompt from "../lib/carouselPrompt.js";
import type * as lib_fal from "../lib/fal.js";
import type * as run from "../run.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  carousel: typeof carousel;
  clients: typeof clients;
  dev: typeof dev;
  jobs: typeof jobs;
  ledger: typeof ledger;
  "lib/carouselPrompt": typeof lib_carouselPrompt;
  "lib/fal": typeof lib_fal;
  run: typeof run;
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
};
