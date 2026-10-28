import { FEATURE_KEYS } from "./features";
import type { FeatureKey, Permissions, PlanId } from "@/types";

export const PLAN_IDS: PlanId[] = ["starter", "growth", "pro"];

function build(enabled: FeatureKey[]): Permissions {
  const set = new Set(enabled);
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, set.has(key)])) as Permissions;
}

/** Default permission combination per plan. Admins can still edit each client individually. */
export const PLAN_PRESETS: Record<PlanId, Permissions> = {
  starter: build([
    "postGenerator",
    "postGenerator.brandVocabulary",
    "postGenerator.regenerate",
    "engagement",
    "engagement.aiReplies",
    "gallery",
    "aiChat",
    "recommendations",
    "reports",
    "postInsights",
    "postInsights.shareability",
    "methods",
    "monitoring",
    "statistics",
    "competitors.analysis",
    "notifications",
    "settings.brandVoice",
  ]),
  growth: build([
    "competitors",
    "competitors.accounts",
    "competitors.trendingHashtags",
    "competitors.analysis",
    "competitors.inspiration",
    "postGenerator",
    "postGenerator.brandVocabulary",
    "postGenerator.regenerate",
    "postGenerator.addToQueue",
    "experiment",
    "experiment.windows",
    "experiment.scheduleQueue",
    "engagement",
    "engagement.dmRules",
    "engagement.aiReplies",
    "engagement.whatsappPricing",
    "gallery",
    "aiChat",
    "recommendations",
    "reports",
    "postInsights",
    "postInsights.shareability",
    "methods",
    "monitoring",
    "statistics",
    "notifications",
    "settings.brandVoice",
  ]),
  pro: build([...FEATURE_KEYS]),
};

/** Default limits per plan. Admins can change them on the System page (SystemSetting "planLimits"). */
export type PlanLimits = {
  /** Competitor accounts a business can track. */
  competitors: number;
  /** Posts a business can monitor at the same time ("Monitor this post"). */
  monitoredPosts: number;
  /** Instagram accounts one login can switch between (the account switcher's "Add account"). */
  instagramAccounts: number;
};

export const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: { competitors: 5, monitoredPosts: 5, instagramAccounts: 1 },
  growth: { competitors: 5, monitoredPosts: 5, instagramAccounts: 1 },
  pro: { competitors: 5, monitoredPosts: 5, instagramAccounts: 1 },
};

/** Bounds for the admin's settings. */
export const MAX_COMPETITORS_LIMIT = 20;
export const MAX_MONITORED_POSTS_LIMIT = 25;
export const MAX_INSTAGRAM_ACCOUNTS_LIMIT = 20;
