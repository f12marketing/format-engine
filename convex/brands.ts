import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { currentClient, requireClient } from "./clients";
import {
  BUSINESS_MODELS,
  CATEGORIES,
  GOALS,
  INTENTS,
  QUIZ_STEPS,
  REVENUE_BANDS,
  ROLES,
  SOURCES,
  TEAM_SIZES,
  TEXT_LIMITS,
} from "./lib/businessQuiz";

/**
 * The business profile behind "Mention your business?".
 *
 * One row per client, filled in once by the sign-up quiz (/onboarding) and
 * editable afterwards on the Business page -- never re-asked per video.
 * Every format that mentions the business writes from it -- see
 * `businessContext` in lib/businessContext.ts.
 */

async function brandFor(
  ctx: QueryCtx | MutationCtx,
  clientId: Id<"clients">,
): Promise<Doc<"brands"> | null> {
  return ctx.db
    .query("brands")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .first();
}

/**
 * The signed-in client's profile, or null when there isn't one yet.
 * `needsOnboarding` is what sends a new client to the quiz.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const client = await currentClient(ctx);
    if (!client) return null;
    const b = await brandFor(ctx, client._id);
    if (!b) return null;
    return {
      name: b.name,
      contactName: b.contactName ?? "",
      description: b.description ?? "",
      audience: b.audience ?? "",
      problem: b.problem ?? "",
      benefits: b.benefits ?? "",
      website: b.website ?? "",
      tone: b.tone ?? "",
      palette: b.palette ?? [],
      logoAssetId: b.logoAssetId ?? null,
      logoUrl: b.logoAssetId ? await logoUrl(ctx, b.logoAssetId) : null,
      businessModel: b.businessModel ?? "",
      categories: b.categories ?? [],
      role: b.role ?? "",
      teamSize: b.teamSize ?? "",
      monthlyRevenue: b.monthlyRevenue ?? "",
      signupIntent: b.signupIntent ?? "",
      goals: b.goals ?? [],
      heardFrom: b.heardFrom ?? [],
      quizStep: b.quizStep ?? "basics",
      onboarded: Boolean(b.onboardedAt),
      testimonialGuard: b.testimonialGuard !== false,
    };
  },
});

async function logoUrl(ctx: QueryCtx, assetId: Id<"assets">): Promise<string | null> {
  const asset = await ctx.db.get(assetId);
  return asset ? ctx.storage.getUrl(asset.storageId) : null;
}

/**
 * Whether the app should send this client to the quiz: signed in, admitted,
 * and neither finished nor skipped it. Separate from `mine` so the app-wide
 * gate subscribes to one boolean rather than the whole profile.
 */
export const needsOnboarding = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const client = await currentClient(ctx);
    if (!client || client.archived) return false;
    const b = await brandFor(ctx, client._id);
    return !b || (!b.onboardedAt && !b.onboardingSkippedAt);
  },
});

// ---------------------------------------------------------------- writes

const text = (s: string | undefined, max: number) =>
  s === undefined ? undefined : s.trim().slice(0, max);
const oneOf = (s: string | undefined, allowed: readonly string[]) =>
  s === undefined ? undefined : allowed.includes(s) ? s : "";
const someOf = (xs: string[] | undefined, allowed: readonly string[]) =>
  xs === undefined ? undefined : [...new Set(xs.filter((x) => allowed.includes(x)))];

/**
 * Any subset of the profile: each quiz step saves its own answers, and the
 * Business page saves whatever changed. Every value is re-checked here --
 * free text trimmed and capped, chips kept only when they're real options,
 * colours only when they're hex -- because the form is not the boundary.
 */
export const saveProfile = mutation({
  args: {
    name: v.optional(v.string()),
    contactName: v.optional(v.string()),
    website: v.optional(v.string()),
    description: v.optional(v.string()),
    audience: v.optional(v.string()),
    problem: v.optional(v.string()),
    benefits: v.optional(v.string()),
    tone: v.optional(v.string()),
    palette: v.optional(v.array(v.string())),
    logoAssetId: v.optional(v.union(v.id("assets"), v.null())),
    businessModel: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    role: v.optional(v.string()),
    teamSize: v.optional(v.string()),
    monthlyRevenue: v.optional(v.string()),
    signupIntent: v.optional(v.string()),
    goals: v.optional(v.array(v.string())),
    heardFrom: v.optional(v.array(v.string())),
    quizStep: v.optional(v.string()),
    testimonialGuard: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const client = await requireClient(ctx);

    if (a.logoAssetId) {
      const logo = await ctx.db.get(a.logoAssetId);
      if (!logo || logo.clientId !== client._id || logo.kind !== "image") {
        throw new Error("That logo could not be found.");
      }
    }

    const patch = {
      name: text(a.name, TEXT_LIMITS.name),
      contactName: text(a.contactName, TEXT_LIMITS.contactName),
      website: text(a.website, TEXT_LIMITS.website),
      description: text(a.description, TEXT_LIMITS.description),
      audience: text(a.audience, TEXT_LIMITS.audience),
      problem: text(a.problem, TEXT_LIMITS.problem),
      benefits: text(a.benefits, TEXT_LIMITS.benefits),
      tone: text(a.tone, TEXT_LIMITS.tone),
      palette:
        a.palette === undefined
          ? undefined
          : a.palette.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).map((c) => c.toUpperCase()).slice(0, 6),
      logoAssetId: a.logoAssetId === null ? undefined : a.logoAssetId,
      businessModel: oneOf(a.businessModel, BUSINESS_MODELS),
      categories: someOf(a.categories, CATEGORIES),
      role: oneOf(a.role, ROLES),
      teamSize: oneOf(a.teamSize, TEAM_SIZES),
      monthlyRevenue: oneOf(a.monthlyRevenue, REVENUE_BANDS),
      signupIntent: oneOf(a.signupIntent, INTENTS),
      goals: someOf(a.goals, GOALS),
      heardFrom: someOf(a.heardFrom, SOURCES),
      quizStep: oneOf(a.quizStep, QUIZ_STEPS) || undefined,
      testimonialGuard: a.testimonialGuard,
    };
    // Only what was sent. An explicitly removed logo is the one field that
    // has to be cleared rather than left alone, so it is patched as undefined.
    const fields = Object.fromEntries(
      Object.entries(patch).filter(
        ([k, val]) => val !== undefined || (k === "logoAssetId" && a.logoAssetId === null),
      ),
    ) as Partial<Doc<"brands">>;

    const existing = await brandFor(ctx, client._id);
    if (existing) {
      if (fields.name === "") throw new Error("The business needs a name.");
      await ctx.db.patch(existing._id, fields);
    } else {
      if (!fields.name) throw new Error("Start with the business's name.");
      const present = Object.fromEntries(
        Object.entries(fields).filter(([, val]) => val !== undefined),
      ) as Partial<Doc<"brands">>;
      await ctx.db.insert("brands", { ...present, clientId: client._id, name: fields.name });
    }
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const b = await brandFor(ctx, client._id);
    if (!b) throw new Error("Start with the business's name.");
    if (!b.description) throw new Error("Tell us what the business does first.");
    await ctx.db.patch(b._id, { onboardedAt: Date.now(), quizStep: "done" });
  },
});

export const skipOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const client = await requireClient(ctx);
    const b = await brandFor(ctx, client._id);
    if (b) {
      await ctx.db.patch(b._id, { onboardingSkippedAt: Date.now() });
    } else {
      // Nothing to hang the flag on yet, so a placeholder row the quiz or the
      // toggle's card will fill in later. `name` is required by the schema.
      await ctx.db.insert("brands", {
        clientId: client._id,
        name: client.displayName,
        onboardingSkippedAt: Date.now(),
      });
    }
  },
});

/** Read from a workflow step, where there is no auth context. */
export const forClientInternal = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => brandFor(ctx, clientId),
});

/**
 * The profile as a paragraph for a system prompt. Kept beside the table so
 * every format that mentions the business describes it the same way. The
 * "who's posting" lines matter as much as the business ones: first-person
 * copy from a solo founder and from a 50-person team's social manager should
 * not sound alike.
 */
export function businessBrief(b: Doc<"brands">): string {
  const who = [b.contactName, b.role, b.teamSize && `team: ${b.teamSize}`]
    .filter(Boolean)
    .join(", ");
  return [
    `Business: ${b.name}`,
    b.description && `What it sells / does: ${b.description}`,
    b.audience && `Who it's for: ${b.audience}`,
    b.problem && `Problem it solves: ${b.problem}`,
    b.benefits && `Why customers choose it: ${b.benefits}`,
    (b.businessModel || b.categories?.length) &&
      `Type: ${[b.businessModel, ...(b.categories ?? [])].filter(Boolean).join(", ")}`,
    b.tone && `Brand voice: ${b.tone}`,
    b.website && `Website: ${b.website}`,
    who && `Who is posting: ${who}`,
  ]
    .filter(Boolean)
    .join("\n");
}
