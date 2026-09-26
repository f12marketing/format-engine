import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { businessBrief } from "../brands";

/**
 * What "Mention your business" adds to a prompt, for every format.
 *
 * Off: nothing. On: the client's saved profile (from the sign-up quiz or the
 * Business page) and the format's own instruction for how to use it. A client
 * with no profile yet -- one who skipped the quiz -- still gets the old bare
 * instruction rather than a failed run; Wall of Text, which is written around
 * the profile, refuses before it gets here instead.
 *
 * Starts with a blank line, so callers append it to a prompt as it is.
 */
export async function businessContext(
  ctx: ActionCtx,
  clientId: Id<"clients">,
  on: boolean | undefined,
  how = "Mention the business by name, naturally -- never as an ad read.",
): Promise<string> {
  if (!on) return "";
  const brand = await ctx.runQuery(internal.brands.forClientInternal, { clientId });
  const guard = testimonialRule(brand);
  if (!brand?.description) return `\n\n${how}${guard}`;
  return `\n\nBusiness profile:\n${businessBrief(brand)}\n\n${how} Use only what the profile says -- never invent prices, results or claims.${guard}`;
}

/**
 * The business page's "Keep scripts clear of fake reviews" switch, on unless
 * the client turns it off. The FTC's endorsement rules (16 CFR 255) and its
 * fake-reviews rule (16 CFR 465) bar an ad from presenting someone as a real
 * customer describing an experience they didn't have -- and the person on
 * screen here is often AI-generated, or an actor reading a line. So the
 * speaker may react, ask, or say what the business does, but never claim to
 * have used it or what it did for them.
 *
 * Tuned against the formats' first-person styles, which pull hard the other
 * way. With a general "never write a review" line, 3 in 6 Wall of Text
 * posts, 4 in 6 meme captions and 2 in 6 Image Slideshow decks still said
 * "just downloaded X" or "me realizing X already filed it" (six runs each,
 * an LLM judge checking against this rule). Naming those constructions,
 * giving the story a role (the problem) and the business one (a find, said
 * as what it CAN do), and having each format's system prompt defer to this
 * rule instead of modeling "an app they actually use" took all three to 0 in 6.
 */
const NO_FAKE_TESTIMONIAL =
  "The speaker has NOT used the business: they are not a verified customer. So they never " +
  "downloaded, bought, tried, switched to or use it, and it has done nothing for them yet -- no " +
  '"just downloaded X", "been using X", "X saved me hours", "me realizing X already filed my ' +
  'receipts". Their story is the problem; the business is something they have just heard about ' +
  "or found, and what it does is something it CAN do, never something it already did for them. " +
  'Fine: "apparently X can [thing]", "wait, X can [thing]?", "someone tell me why nobody ' +
  'mentioned X", saying what it does, or speaking as the business itself.';

/** When the client switched the rule off: said out loud, so the prompts' own default doesn't win. */
const REAL_CUSTOMER =
  "The speaker is a real customer, so they may describe their own experience with it -- only " +
  "what the profile supports.";

/** The rule, with a leading space. For every prompt that names the business. */
export function testimonialRule(brand: { testimonialGuard?: boolean } | null | undefined): string {
  return ` ${brand?.testimonialGuard === false ? REAL_CUSTOMER : NO_FAKE_TESTIMONIAL}`;
}
