import type { FeatureKey, NotificationPrefs } from "@/types";

/**
 * Every in-app notification type: the preference that switches it off, the feature it
 * belongs to (no notification when that module is off for the client) and the page it
 * opens. To add a type: add it here, call notify() where it happens, and add its text
 * under notifications.types.<type> in both locale files. Pure — shared by server and UI.
 */

export const NOTIFICATION_TYPES = {
  recommendations_ready: { pref: "recommendationsReady", features: ["recommendations"], href: "/recommendations" },
  weekly_report: { pref: "weeklyReport", features: ["reports"], href: "/reports" },
  instagram_reconnect: { pref: "instagramReconnect", features: [], href: "/settings#instagram" },
  post_published: { pref: "scheduledPosts", features: ["postGenerator.addToQueue", "experiment.scheduleQueue"], href: "/gallery" },
  post_failed: { pref: "scheduledPosts", features: ["postGenerator.addToQueue", "experiment.scheduleQueue"], href: "/gallery" },
  replies_waiting: { pref: "approvalNeeded", features: ["engagement.aiReplies", "engagement.dmRules"], href: "/engagement" },
  monitor_above: { pref: "postMonitoring", features: ["monitoring"], href: "/post-monitoring" },
  monitor_reach_above: { pref: "postMonitoring", features: ["monitoring"], href: "/post-monitoring" },
  monitor_below: { pref: "postMonitoring", features: ["monitoring"], href: "/post-monitoring" },
  monitor_ended: { pref: "postMonitoring", features: ["monitoring"], href: "/post-monitoring" },
} as const satisfies Record<string, { pref: keyof NotificationPrefs; features: readonly FeatureKey[]; href: string }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const isNotificationType = (value: string): value is NotificationType => value in NOTIFICATION_TYPES;

/** The preferences shown in Settings → Notifications, in order, with the features any of which makes them relevant. */
export const NOTIFICATION_SETTINGS: Array<{ pref: keyof NotificationPrefs; features: readonly FeatureKey[] }> = [
  { pref: "recommendationsReady", features: NOTIFICATION_TYPES.recommendations_ready.features },
  { pref: "weeklyReport", features: NOTIFICATION_TYPES.weekly_report.features },
  { pref: "approvalNeeded", features: NOTIFICATION_TYPES.replies_waiting.features },
  { pref: "scheduledPosts", features: NOTIFICATION_TYPES.post_published.features },
  { pref: "postMonitoring", features: NOTIFICATION_TYPES.monitor_ended.features },
  { pref: "instagramReconnect", features: [] },
];

/** A type is relevant when it needs no feature, or any of its features is on. */
export function notificationRelevant(features: readonly FeatureKey[], enabled: (key: FeatureKey) => boolean): boolean {
  return features.length === 0 || features.some(enabled);
}
