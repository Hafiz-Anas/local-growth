import type { MediaTone } from "./client";

export type MediaIcon = "coffee" | "nut" | "cake" | "gift" | "truck" | "cup" | "shirt" | "bag" | "gem" | "sparkles";

export interface MetricValue {
  value: number;
  /** Change vs. previous period, in percent. */
  changePct: number;
  /** False when Instagram has no data for this metric yet (small or new accounts). Absent = available. */
  available?: boolean;
}

export interface FollowerPoint {
  date: string; // ISO date
  followers: number;
}

export interface PostSummary {
  id: string;
  caption: string;
  tone: MediaTone;
  icon: MediaIcon;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  postedAt: string;
}

export interface DashboardData {
  metrics: {
    reach: MetricValue;
    engagementRate: MetricValue;
    followerGrowth: MetricValue;
    profileVisits: MetricValue;
  };
  followerSeries: FollowerPoint[];
  topPost: PostSummary;
  quickTiles: {
    commentsHandledToday: number;
    repliesAwaitingApproval: number;
    nextWindow: { window: "morning" | "afternoon" | "evening"; start: string; end: string; liftPct: number };
  };
}
