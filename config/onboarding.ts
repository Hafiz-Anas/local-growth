/*
 * Self-onboarding catalogue, shared by server and client: wizard steps, the
 * business types and post purposes offered, and the limits the API enforces.
 * Labels live in the locale files under onboarding.* / purposes.*.
 */

/**
 * Wizard steps in order. `Business.onboardingStep` is the 1-based index into this list.
 * Connecting Instagram comes first (migration 20261009090000_onboarding_instagram_first
 * moved businesses that were mid-way under the old business-first order).
 */
export const ONBOARDING_STEPS = ["instagram", "business", "competitors", "posts", "brand", "review", "result"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

/** Steps shown in the progress bar ("result" is the end of "review"). */
export const PROGRESS_STEPS = ONBOARDING_STEPS.slice(0, 6);

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

/** Competitors that must be Ready before step 3 can continue. */
export const MIN_READY_COMPETITORS = 5;
/** Handles (ready or not) a business can list during onboarding. */
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
