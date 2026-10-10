import type { FEATURE_KEYS } from "@/config/features";

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** ON/OFF map for every feature key. Missing keys are treated as OFF. */
export type Permissions = Record<FeatureKey, boolean>;

export type PlanId = "starter" | "growth" | "pro";
