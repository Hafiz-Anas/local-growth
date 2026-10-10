export type ActivityKind =
  | "post_published"
  | "reply_approved"
  | "dm_rule_triggered"
  | "connection_issue"
  | "plan_changed"
  | "experiment_finished";

export interface ActivityItem {
  id: string;
  clientId: string;
  kind: ActivityKind;
  /** English + Arabic copy so the feed can render in either locale. */
  message: string;
  messageAr: string;
  at: string;
}

export type ServiceHealth = "operational" | "degraded" | "down";

export interface RateLimitUsage {
  clientId: string;
  used: number;
  limit: number;
  resetsAt: string;
}

export interface SystemStatus {
  instagramApi: { status: ServiceHealth; latencyMs: number; uptimePct: number; checkedAt: string };
  webhooks: { status: ServiceHealth; lastEventAt: string; deliveredToday: number; failedToday: number };
  rateLimits: RateLimitUsage[];
}
