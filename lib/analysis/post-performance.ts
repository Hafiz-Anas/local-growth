import { interactions, type AnalysisPost } from "./posts";

/**
 * One post compared with the account's average, its metrics over time (daily snapshots taken
 * by the cron), and the "recent posts" comparison. Only measured numbers: a metric Instagram
 * didn't report is null and is never estimated. Pure; tested in tests/analysis.test.ts.
 */

export const POST_METRICS = ["likes", "comments", "reach", "saves", "shares", "views"] as const;
export type PostMetric = (typeof POST_METRICS)[number];

export interface MetricVsAverage {
  metric: PostMetric;
  value: number | null;
  /** Average of the same metric over the other recent posts that have it; null without any. */
  average: number | null;
  /** Percent above (+) or below (−) the average; null when it can't be compared. */
  vsAveragePct: number | null;
  /** How many posts the average is based on. */
  basedOn: number;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const value = (p: AnalysisPost, m: PostMetric): number | null => (m === "likes" ? p.likes : m === "comments" ? p.comments : p[m]);

/** Each metric of `post` against the average of the other posts (each metric only from posts that report it). */
export function postVsAverage(post: AnalysisPost, others: AnalysisPost[]): MetricVsAverage[] {
  const peers = others.filter((p) => p.id !== post.id);
  return POST_METRICS.map((metric) => {
    const v = value(post, metric);
    const values = peers.map((p) => value(p, metric)).filter((x): x is number => x !== null && (metric === "likes" || metric === "comments" || x > 0));
    const average = values.length ? round(avg(values)) : null;
    const vsAveragePct = v !== null && average !== null && average > 0 ? round(((v - average) / average) * 100) : null;
    return { metric, value: v, average, vsAveragePct, basedOn: values.length };
  }).filter((m) => m.value !== null);
}

export interface SnapshotRow {
  /** YYYY-MM-DD */
  date: string;
  likes: number;
  comments: number;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
}

export interface SeriesPoint extends SnapshotRow {
  interactions: number;
}

/** Snapshots oldest first, one per day, plus how much each metric grew over the span. */
export function postSeries(rows: SnapshotRow[]): { points: SeriesPoint[]; growth: Partial<Record<PostMetric | "interactions", number>> } {
  const byDay = new Map<string, SnapshotRow>();
  for (const r of rows) byDay.set(r.date, r);
  const points = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, interactions: r.likes + r.comments }));
  const growth: Partial<Record<PostMetric | "interactions", number>> = {};
  if (points.length >= 2) {
    const first = points[0];
    const last = points.at(-1)!;
    for (const m of [...POST_METRICS, "interactions"] as const) {
      const a = first[m];
      const b = last[m];
      if (typeof a === "number" && typeof b === "number") growth[m] = b - a;
    }
  }
  return { points, growth };
}

export interface RecentPostRow {
  id: string;
  postedAt: string;
  format: AnalysisPost["format"];
  caption: string;
  likes: number;
  comments: number;
  interactions: number;
  reach: number | null;
  saves: number | null;
  /** Interactions vs the average of these posts, percent. */
  vsAveragePct: number;
  rank: number;
}

export interface RecentSummary {
  posts: RecentPostRow[];
  avgInteractions: number;
  avgReach: number | null;
  best: string | null;
  weakest: string | null;
  /** Newest half vs older half, average interactions percent change; null with fewer than 4 posts. */
  trendPct: number | null;
}

/** The last `count` posts compared with each other, newest first. */
export function recentSummary(posts: AnalysisPost[], count = 10): RecentSummary {
  const recent = [...posts].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, count);
  const average = avg(recent.map(interactions));
  const reached = recent.filter((p) => p.reach !== null && p.reach > 0);
  const ranked = [...recent].sort((a, b) => interactions(b) - interactions(a));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
  let trendPct: number | null = null;
  if (recent.length >= 4) {
    const half = Math.floor(recent.length / 2);
    const newer = avg(recent.slice(0, half).map(interactions));
    const older = avg(recent.slice(half).map(interactions));
    trendPct = older > 0 ? round(((newer - older) / older) * 100) : null;
  }
  return {
    posts: recent.map((p) => ({
      id: p.id,
      postedAt: p.postedAt,
      format: p.format,
      caption: p.caption,
      likes: p.likes,
      comments: p.comments,
      interactions: interactions(p),
      reach: p.reach,
      saves: p.saves,
      vsAveragePct: average > 0 ? round(((interactions(p) - average) / average) * 100) : 0,
      rank: rankOf.get(p.id)!,
    })),
    avgInteractions: round(average),
    avgReach: reached.length ? Math.round(avg(reached.map((p) => p.reach!))) : null,
    best: ranked[0]?.id ?? null,
    weakest: ranked.length > 1 ? ranked.at(-1)!.id : null,
    trendPct,
  };
}
