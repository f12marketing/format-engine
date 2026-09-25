/**
 * The business quiz's closed answers, shared by the quiz, the Business page
 * and the server that validates what they send. A chip the server doesn't
 * know is dropped rather than stored, so the profile only ever holds answers
 * the prompts were written to understand.
 */

export const ROLES = [
  "Founder",
  "Marketing lead",
  "Social media manager",
  "Agency owner",
  "Freelancer",
  "Content creator",
  "Product manager",
  "Growth lead",
  "Other",
] as const;

export const TEAM_SIZES = ["Just me", "2–5", "6–10", "11–20", "21–50", "50+"] as const;

export const REVENUE_BANDS = [
  "Pre-revenue",
  "$1–1k / mo",
  "$1k–10k / mo",
  "$10k–50k / mo",
  "$50k–500k / mo",
  "$500k+ / mo",
] as const;

export const BUSINESS_MODELS = ["B2B", "B2C", "Both"] as const;

export const CATEGORIES = [
  "SaaS",
  "E-commerce",
  "Agency",
  "Services",
  "Marketplace",
  "Mobile app",
  "Media / content",
  "Local business",
  "Education",
  "Health & wellness",
  "Other",
] as const;

export const INTENTS = [
  "I need content now",
  "I'm planning ahead",
  "Just exploring",
] as const;

export const GOALS = [
  "Save time on content",
  "More views and reach",
  "Traffic to my site",
  "More sales",
  "Grow a personal brand",
  "Get better at content",
] as const;

export const SOURCES = [
  "TikTok",
  "Instagram",
  "YouTube",
  "LinkedIn",
  "X / Twitter",
  "Reddit",
  "Google",
  "Podcast",
  "Newsletter",
  "Friend or colleague",
  "Other",
] as const;

/** Voice chips. Free text is allowed too; these are the quick picks. */
export const TONES = [
  "Friendly",
  "Bold",
  "Witty",
  "Warm",
  "Straight-talking",
  "Playful",
  "Premium",
  "Nerdy",
  "Calm",
  "Irreverent",
] as const;

/** The quiz's steps, in order. Stored as the step reached, so a refresh resumes there. */
export const QUIZ_STEPS = [
  "basics",
  "source",
  "understood",
  "you",
  "business",
  "goals",
  "heard",
  "done",
] as const;
export type QuizStep = (typeof QUIZ_STEPS)[number];

/** Length caps for the free-text answers, enforced by the controls and again by the server. */
export const TEXT_LIMITS = {
  contactName: 60,
  name: 80,
  website: 200,
  description: 500,
  audience: 300,
  problem: 300,
  benefits: 400,
  tone: 120,
} as const;
