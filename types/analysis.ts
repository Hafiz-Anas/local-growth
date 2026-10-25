import type { AccountStats, FormatShare, GroupStat, GrowthPoint, MetricComparison, PostFormat, Weekday } from "@/lib/analysis/posts";
import type { Method, MethodRank, PromotedComparison } from "@/lib/analysis/methods";
import type { MetricVsAverage, RecentSummary, SeriesPoint } from "@/lib/analysis/post-performance";
import type { CompetitorInsight, PostInsight } from "@/lib/services/text/analysis";

export type { AccountStats, GrowthPoint, MetricComparison, PostFormat, Method, MethodRank, PromotedComparison, MetricVsAverage, RecentSummary, SeriesPoint, CompetitorInsight, PostInsight };

/**
 * The AI text of an analysis: "ready" (written for the current numbers), "stale" (written for
 * older numbers — shown, with a refresh), "none" (not written yet), "unavailable" (the AI
 * couldn't write it; `reason` says why). The numbers never depend on it.
 */
export interface AiTextState<T> {
  status: "ready" | "stale" | "none" | "unavailable";
  text: T | null;
  generatedAt: string | null;
  reason: string | null;
}

export interface AnalysisPostDto {
  id: string;
  caption: string;
  format: PostFormat;
  postedAt: string;
  likes: number;
  comments: number;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
  mediaUrl: string | null;
  permalink: string | null;
}

// ── Part 1: competitors ─────────────────────────────────────────────────────────

export interface CompetitorAnalysisItemDto {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  followers: number;
  /** Why the latest lookup failed (the account went private, isn't a business account, or is gone). */
  issue: "private" | "not_business" | "not_found" | null;
  /** When the competitor's numbers were fetched from Instagram. */
  dataAt: string | null;
  stats: AccountStats | null;
  /** Best posts (by likes + comments), best first. */
  bestPosts: AnalysisPostDto[];
  comparison: MetricComparison[];
  /** Content types estimated from captions (rules, not measured). */
  methods: Array<{ method: Method; posts: number; avgInteractions: number }>;
  growth: { points: GrowthPoint[]; changePct: number | null; weeks: number };
  insight: AiTextState<CompetitorInsight>;
}

export interface CompetitorAnalysisDto {
  you: { handle: string; followers: number | null; stats: AccountStats | null; demo: boolean; connected: boolean };
  competitors: CompetitorAnalysisItemDto[];
  /** Competitors the plan allows, and how many are tracked. */
  limit: number;
  tracked: number;
  timeZone: string;
}

// ── Part 2: methods ─────────────────────────────────────────────────────────────

export interface MethodPostDto extends AnalysisPostDto {
  method: Method;
  /** rule: from the caption; ai: suggested by the AI; user: set by the client. */
  source: "rule" | "ai" | "user";
  promoted: boolean;
}

export interface MethodsDto {
  connected: boolean;
  demo: boolean;
  posts: MethodPostDto[];
  ranking: MethodRank[];
  promoted: PromotedComparison;
  /**
   * The AI's suggestions: "pending" (some posts only have the rule-based guess — the page asks
   * POST /api/methods/suggest), "used", "unavailable" (rules kept; `reason`), "not_needed".
   */
  ai: { status: "pending" | "used" | "unavailable" | "not_needed"; reason: string | null };
  /** Competitors' content types, estimated from captions (only where we have their posts). */
  competitors: Array<{ handle: string; posts: number; methods: Array<{ method: Method; posts: number; avgInteractions: number }> }>;
}

// ── Part 3: post performance ────────────────────────────────────────────────────

export interface PostPerformanceDto {
  connected: boolean;
  demo: boolean;
  summary: RecentSummary;
  /** Media for the rows (image, link). */
  media: Record<string, { mediaUrl: string | null; permalink: string | null }>;
  /** "What works best": post types and weekdays by average interactions, over the stored posts; null without posts. */
  whatWorks: { posts: number; mix: FormatShare[]; days: Array<GroupStat<Weekday>> } | null;
}

export interface PostDetailDto {
  post: AnalysisPostDto;
  method: Method | null;
  promoted: boolean;
  vsAverage: MetricVsAverage[];
  history: { points: SeriesPoint[]; growth: Partial<Record<string, number>> };
  /** How many recent posts the averages come from. */
  comparedWith: number;
  demo: boolean;
  insight: AiTextState<PostInsight>;
}
