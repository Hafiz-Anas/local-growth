import type { FeatureKey } from "@/types";

/*
 * Shared by server and client: the database stores one FeaturePermission row per
 * (business, key), the session carries the list of effective keys, and pages,
 * API routes, navigation and widgets all check against these keys.
 */

/**
 * Feature catalogue. Every module and sub-feature that can be switched ON/OFF
 * per client is declared here — navigation, widgets, route guards and
 * the admin permissions page all read from this single list.
 *
 * Key convention: a module key has no dot ("engagement"); a sub-feature key is
 * "<module>.<feature>". A sub-feature is only effective when its module is ON.
 */
export const FEATURE_KEYS = [
  "competitors",
  "competitors.accounts",
  "competitors.trendingAudio",
  "competitors.trendingHashtags",
  "competitors.analysis",

  "postGenerator",
  "postGenerator.brandVocabulary",
  "postGenerator.regenerate",
  "postGenerator.addToQueue",

  "experiment",
  "experiment.windows",
  "experiment.heatmap",
  "experiment.scheduleQueue",

  "engagement",
  "engagement.dmRules",
  "engagement.aiReplies",
  "engagement.autoReply",
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
] as const;

export interface FeatureModuleDef {
  /** Translation namespace: features.<id>.* */
  id: "competitors" | "postGenerator" | "experiment" | "engagement" | "gallery" | "aiChat" | "recommendations" | "reports" | "postInsights" | "methods" | "monitoring" | "statistics" | "notifications" | "settings";
  /** Module-level toggle; `null` when the module itself is always available (settings). */
  moduleKey: FeatureKey | null;
  subFeatures: FeatureKey[];
}

export const FEATURE_MODULES: FeatureModuleDef[] = [
  {
    id: "competitors",
    moduleKey: "competitors",
    subFeatures: ["competitors.accounts", "competitors.trendingAudio", "competitors.trendingHashtags", "competitors.analysis"],
  },
  {
    id: "postGenerator",
    moduleKey: "postGenerator",
    subFeatures: ["postGenerator.brandVocabulary", "postGenerator.regenerate", "postGenerator.addToQueue"],
  },
  {
    id: "experiment",
    moduleKey: "experiment",
    subFeatures: ["experiment.windows", "experiment.heatmap", "experiment.scheduleQueue"],
  },
  {
    id: "engagement",
    moduleKey: "engagement",
    subFeatures: [
      "engagement.dmRules",
      "engagement.aiReplies",
      "engagement.autoReply",
      "engagement.whatsappPricing",
    ],
  },
  {
    id: "gallery",
    moduleKey: "gallery",
    subFeatures: [],
  },
  {
    id: "aiChat",
    moduleKey: "aiChat",
    subFeatures: [],
  },
  {
    id: "recommendations",
    moduleKey: "recommendations",
    subFeatures: [],
  },
  {
    id: "reports",
    moduleKey: "reports",
    subFeatures: [],
  },
  {
    id: "postInsights",
    moduleKey: "postInsights",
    subFeatures: ["postInsights.shareability"],
  },
  {
    id: "methods",
    moduleKey: "methods",
    subFeatures: [],
  },
  {
    id: "monitoring",
    moduleKey: "monitoring",
    subFeatures: [],
  },
  {
    id: "statistics",
    moduleKey: "statistics",
    subFeatures: [],
  },
  {
    id: "notifications",
    moduleKey: "notifications",
    subFeatures: [],
  },
  {
    id: "settings",
    moduleKey: null,
    subFeatures: ["settings.brandVoice"],
  },
];

/**
 * Modules added without a data migration (no FeaturePermission rows for existing businesses):
 * until an admin saves a value for a business, a missing row counts as ON.
 */
export const DEFAULT_ON_WITHOUT_ROW: readonly FeatureKey[] = ["gallery", "aiChat"];
