import type { MonitorAlerts, MonitorBaseline, MonitorDuration, MonitorInterval, MonitorOutcome, MonitorPoint } from "@/lib/analysis/monitoring";
import type { PostFormat } from "@/lib/analysis/posts";
import type { AiTextState } from "./analysis";

export type { MonitorAlerts, MonitorBaseline, MonitorDuration, MonitorInterval, MonitorOutcome, MonitorPoint };

export type MonitorStatus = "active" | "ended" | "stopped" | "unavailable";

/** The monitored post as it was when monitoring started (image and link refreshed while it is recent). */
export interface MonitorPostDto {
  caption: string;
  format: PostFormat;
  postedAt: string;
  mediaUrl: string | null;
  permalink: string | null;
}

export interface MonitorSummaryText {
  en: string;
  ar: string;
}

export interface MonitorItemDto {
  id: string;
  igMediaId: string;
  post: MonitorPostDto;
  status: MonitorStatus;
  duration: MonitorDuration;
  interval: MonitorInterval;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  lastReadingAt: string | null;
  /** Why the last reading failed: "not_connected" | "rate_limited" | "permission" | "failed"; null when it worked. */
  lastError: string | null;
  /** The newest reading. */
  latest: MonitorPoint | null;
  readings: number;
  /** Likes + comments over the monitoring period, for the mini chart (at most 24 points). */
  spark: number[];
  /** Likes + comments of the newest reading vs the account's average, percent; null without a comparison. */
  vsAveragePct: number | null;
  /** Ended monitors: the AI's short summary (null: numbers only). */
  summary: MonitorSummaryText | null;
}

export interface MonitoringDto {
  connected: boolean;
  demo: boolean;
  /** Posts the plan allows to monitor at the same time. */
  limit: number;
  active: MonitorItemDto[];
  /** Ended, stopped and unavailable monitors, newest first. */
  history: MonitorItemDto[];
  /** Recent posts that can be monitored (newest first). */
  posts: Array<{ id: string; caption: string; format: PostFormat; postedAt: string; mediaUrl: string | null }>;
}

export interface MonitorDetailDto extends MonitorItemDto {
  points: MonitorPoint[];
  baseline: MonitorBaseline;
  alerts: MonitorAlerts;
  /** Final numbers, once monitoring has ended. */
  outcome: MonitorOutcome | null;
  summaryState: AiTextState<MonitorSummaryText>;
  demo: boolean;
}
