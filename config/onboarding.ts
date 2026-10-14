/*
 * Self-onboarding catalogue, shared by server and client: wizard steps, the
 * business types and post purposes offered, and the limits the API enforces.
 * Labels live in the locale files under onboarding.* / purposes.*.
 */

/**
 * Wizard steps in order (light by design: connect, confirm what the AI filled in, tap a few
 * choices, optionally add competitors). `Business.onboardingStep` is the 1-based index into
 * this list — reordering needs a data migration (20261014180000_simpler_onboarding remapped
 * the old 7-step wizard). Only "brand" asks for anything (the business name); the rest have
 * defaults or are optional, and nothing waits for the AI.
 */
export const ONBOARDING_STEPS = ["instagram", "brand", "goals", "competitors"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** Steps shown in the progress bar. */
export const PROGRESS_STEPS = ONBOARDING_STEPS;

/** Event steps also include the sign-up form, which happens before the wizard. */
export const EVENT_STEPS = ["signup", ...ONBOARDING_STEPS] as const;
export type EventStepId = (typeof EVENT_STEPS)[number];

export const stepNumber = (id: OnboardingStepId) => ONBOARDING_STEPS.indexOf(id) + 1;
export const stepId = (n: number): OnboardingStepId => ONBOARDING_STEPS[Math.min(Math.max(n, 1), ONBOARDING_STEPS.length) - 1];

export const BUSINESS_TYPES = ["roastery", "cafe", "restaurant", "bakery", "sweets", "retail", "beauty", "services", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const POST_PURPOSES = ["menu_product", "promotion", "shop_location", "service", "announcement", "behind_the_scenes", "other"] as const;
export type PostPurpose = (typeof POST_PURPOSES)[number];

export const INSTAGRAM_LANGUAGES = ["ar", "en"] as const;
export type InstagramLanguage = (typeof INSTAGRAM_LANGUAGES)[number];
/** Posting language before it is learned from the brand's captions. */
export const DEFAULT_INSTAGRAM_LANGUAGES: InstagramLanguage[] = ["ar", "en"];

/** Handles (ready or not) a business can list during onboarding (competitors are optional). */
export const MAX_ONBOARDING_COMPETITORS = 15;

/** Posts collected in onboarding; the brand profile in Settings allows more. */
export const ONBOARDING_POST_SLOTS = 5;
export const MAX_BRAND_POSTS = 12;

export const UPLOAD_LIMITS = {
  image: 8 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  logo: 2 * 1024 * 1024,
} as const;

/** Brand colours suggested from the posts. */
export const SUGGESTED_COLORS = { min: 3, max: 5 } as const;
export const MAX_BRAND_COLORS = 6;

/** `#rrggbb` */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// ─── Brand focus and goals (quick chips, each with a default) ───────────────

export const BUSINESS_AIMS = ["more_customers", "more_followers", "more_engagement", "brand_awareness", "more_visits"] as const;
export type BusinessAim = (typeof BUSINESS_AIMS)[number];
export const DEFAULT_AIM: BusinessAim = "more_customers";

export const BUSINESS_GOALS = ["post_consistently", "grow_reach", "more_inquiries", "promote_offers", "launch_products", "build_community"] as const;
export type BusinessGoal = (typeof BUSINESS_GOALS)[number];
export const DEFAULT_GOALS: BusinessGoal[] = ["post_consistently", "grow_reach"];

export const GOAL_TIMELINES = ["1_month", "3_months", "6_months", "ongoing"] as const;
export type GoalTimeline = (typeof GOAL_TIMELINES)[number];
export const DEFAULT_TIMELINE: GoalTimeline = "3_months";

/** Brand tone as three taps (the slider in Settings is finer): values on the 0–100 tone scale. */
export const TONE_PRESETS = { formal: 20, friendly: 50, casual: 80 } as const;
export type TonePreset = keyof typeof TONE_PRESETS;
export const tonePresetOf = (toneLevel: number): TonePreset => (toneLevel < 34 ? "formal" : toneLevel < 67 ? "friendly" : "casual");

/** Below this many posts with a caption, onboarding offers the optional "pick a tone / add an example caption" fallback. */
export const FEW_POSTS = 3;
