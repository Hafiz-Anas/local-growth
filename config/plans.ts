import { FEATURE_KEYS } from "./features";
import type { FeatureKey, Permissions, PlanId } from "@/types";

export const PLAN_IDS: PlanId[] = ["starter", "growth", "pro"];

function build(enabled: FeatureKey[]): Permissions {
  const set = new Set(enabled);
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, set.has(key)])) as Permissions;
}

const DASHBOARD_ALL: FeatureKey[] = [
  "dashboard.profileHeader",
  "dashboard.keyMetrics",
  "dashboard.followerGrowth",
  "dashboard.topPost",
  "dashboard.quickTiles",
];

/** Default permission combination per plan. Admins can still edit each client individually. */
export const PLAN_PRESETS: Record<PlanId, Permissions> = {
  starter: build([
    ...DASHBOARD_ALL,
    "postGenerator",
    "postGenerator.brandVocabulary",
    "postGenerator.regenerate",
    "engagement",
    "engagement.aiReplies",
    "assistant",
    "recommendations",
    "reports",
    "notifications",
    "settings.brandVoice",
  ]),
  growth: build([
    ...DASHBOARD_ALL,
    "competitors",
    "competitors.accounts",
    "competitors.trendingHashtags",
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
    "assistant",
    "recommendations",
    "reports",
    "notifications",
    "settings.brandVoice",
  ]),
  pro: build([...FEATURE_KEYS]),
};

