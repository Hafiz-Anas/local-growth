import { accountStats, interactions, type AnalysisPost, type DayPart, type FormatShare, type GroupStat, type Weekday } from "./posts";

/**
 * The Statistics page: account-level numbers over a period (7 days … 1 year), computed in code.
 * Instagram only gives recent data, so longer trends come from what the app stores itself:
 * a follower snapshot per day and every post it has synced. `availability` says from when.
 * Pure (shared by the server and the UI); tested in tests/statistics.test.ts.
 */

export const STAT_RANGES = ["7d", "30d", "90d", "1y"] as const;
export type StatRange = (typeof STAT_RANGES)[number];
export const isStatRange = (v: unknown): v is StatRange => typeof v === "string" && (STAT_RANGES as readonly string[]).includes(v);

export const RANGE_DAYS: Record<StatRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
export type Bucket = "day" | "week" | "month";
export const BUCKET: Record<StatRange, Bucket> = { "7d": "day", "30d": "day", "90d": "week", "1y": "month" };

const DAY = 24 * 60 * 60 * 1000;
const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface FollowerSnapshot {
  /** YYYY-MM-DD */
  date: string;
  followers: number;
}

/** Start of the bucket a day falls in (UTC): the day, its week's Monday, or the 1st of its month. */
export function bucketStart(date: string, bucket: Bucket): string {
  if (bucket === "day") return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === "month") return `${date.slice(0, 7)}-01`;
  return ymd(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
}

/** Every bucket start from `from` to `to` (inclusive), oldest first. */
export function bucketsBetween(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = [];
  let cursor = bucketStart(from, bucket);
  while (cursor <= to) {
    out.push(cursor);
    const d = new Date(`${cursor}T00:00:00Z`);
    cursor = bucket === "day" ? ymd(d.getTime() + DAY) : bucket === "week" ? ymd(d.getTime() + 7 * DAY) : ymd(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return out;
}

/** Followers on a day: the latest snapshot on or before it, else the earliest one after it; null without snapshots. */
export function followersOn(date: string, snapshots: FollowerSnapshot[]): number | null {
  if (!snapshots.length) return null;
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const before = sorted.filter((s) => s.date <= date).at(-1);
  return (before ?? sorted[0]).followers;
}

export interface PeriodTotals {
  posts: number;
  postsPerWeek: number;
  /** Likes + comments over all posts of the period. */
  interactions: number;
  avgInteractions: number;
  /** Average reach of the period's posts that report it, and how many do. */
  avgReach: number | null;
  reachPosts: number;
  /** Average of each post's likes + comments as a percent of followers when it was posted. */
  engagementPct: number | null;
}

function totals(posts: AnalysisPost[], days: number, snapshots: FollowerSnapshot[], currentFollowers: number | null): PeriodTotals {
  const reached = posts.filter((p) => p.reach !== null && p.reach > 0);
  const rates = posts
    .map((p) => {
      const f = followersOn(p.postedAt.slice(0, 10), snapshots) ?? currentFollowers;
      return f && f > 0 ? (interactions(p) / f) * 100 : null;
    })
    .filter((r): r is number => r !== null);
  return {
    posts: posts.length,
    postsPerWeek: round((posts.length / days) * 7),
    interactions: posts.reduce((n, p) => n + interactions(p), 0),
    avgInteractions: round(avg(posts.map(interactions))),
    avgReach: reached.length ? Math.round(avg(reached.map((p) => p.reach!))) : null,
    reachPosts: reached.length,
    engagementPct: rates.length ? round(avg(rates), 2) : null,
  };
}

export interface StatsPoint {
  /** Bucket start, YYYY-MM-DD. */
  date: string;
  posts: number;
  interactions: number;
  avgReach: number | null;
  engagementPct: number | null;
  /** Followers at the end of the bucket (latest snapshot in it); null without one. */
  followers: number | null;
}

export interface StatisticsData {
  range: StatRange;
  bucket: Bucket;
  /** First and last day of the period (UTC). */
  from: string;
  to: string;
  availability: {
    /** First day with a stored follower count; null when there is none. */
    followersFrom: string | null;
    /** Oldest post we have; null without posts. */
    postsFrom: string | null;
    /** False when the period starts before the data we have: the numbers cover only part of it. */
    complete: boolean;
  };
  followers: { start: number; end: number; change: number; changePct: number | null; points: number } | null;
  current: PeriodTotals;
  /** The period before (same length), for comparison; null when we have no data for it. */
  previous: PeriodTotals | null;
  series: StatsPoint[];
  bestDays: Array<GroupStat<Weekday>>;
  bestTimes: Array<GroupStat<DayPart>>;
  mix: FormatShare[];
}

export interface StatisticsInput {
  range: StatRange;
  posts: AnalysisPost[];
  snapshots: FollowerSnapshot[];
  currentFollowers: number | null;
  timeZone: string;
  now?: number;
}

/** Everything the Statistics page shows for one period. */
export function computeStatistics({ range, posts, snapshots, currentFollowers, timeZone, now = Date.now() }: StatisticsInput): StatisticsData {
  const days = RANGE_DAYS[range];
  const bucket = BUCKET[range];
  const to = ymd(now);
  const from = ymd(now - (days - 1) * DAY);
  const prevFrom = ymd(now - (2 * days - 1) * DAY);
  const day = (p: AnalysisPost) => p.postedAt.slice(0, 10);
  const inRange = posts.filter((p) => day(p) >= from && day(p) <= to);
  const inPrevious = posts.filter((p) => day(p) >= prevFrom && day(p) < from);
  const snaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const snapsInRange = snaps.filter((s) => s.date >= from && s.date <= to);

  const followersFrom = snaps[0]?.date ?? null;
  const postsFrom = posts.length ? posts.map(day).sort()[0] : null;
  const dataFrom = [followersFrom, postsFrom].filter((d): d is string => d !== null).sort()[0] ?? null;

  let followers: StatisticsData["followers"] = null;
  if (snapsInRange.length) {
    const start = snaps.filter((s) => s.date <= from).at(-1) ?? snapsInRange[0];
    const end = snapsInRange.at(-1)!;
    followers = {
      start: start.followers,
      end: end.followers,
      change: end.followers - start.followers,
      changePct: start.followers > 0 ? round(((end.followers - start.followers) / start.followers) * 100) : null,
      points: snapsInRange.length,
    };
  }

  const series = bucketsBetween(from, to, bucket).map((start, i, all) => {
    const next = all[i + 1] ?? "9999-12-31";
    const group = inRange.filter((p) => day(p) >= start && day(p) < next);
    const t = totals(group, 7, snaps, currentFollowers);
    const lastSnap = snapsInRange.filter((s) => s.date >= start && s.date < next).at(-1);
    return { date: start, posts: group.length, interactions: t.interactions, avgReach: t.avgReach, engagementPct: t.engagementPct, followers: lastSnap?.followers ?? null };
  });

  const stats = accountStats(inRange, currentFollowers, timeZone, now);
  return {
    range,
    bucket,
    from,
    to,
    availability: { followersFrom, postsFrom, complete: dataFrom !== null && dataFrom <= from },
    followers,
    current: totals(inRange, days, snaps, currentFollowers),
    previous: inPrevious.length ? totals(inPrevious, days, snaps, currentFollowers) : null,
    series,
    bestDays: stats ? [...stats.byWeekday].sort((a, b) => b.avgInteractions - a.avgInteractions) : [],
    bestTimes: stats ? [...stats.byDayPart].sort((a, b) => b.avgInteractions - a.avgInteractions) : [],
    mix: stats?.mix ?? [],
  };
}

/** Percent change from `before` to `now`; null when it can't be compared. */
export function changePct(now: number | null, before: number | null | undefined): number | null {
  if (now === null || before === null || before === undefined || before === 0) return null;
  return round(((now - before) / before) * 100);
}
