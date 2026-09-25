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
  if (!brand?.description) return `\n\n${how}`;
  return `\n\nBusiness profile:\n${businessBrief(brand)}\n\n${how} Use only what the profile says -- never invent prices, results or claims.`;
}
