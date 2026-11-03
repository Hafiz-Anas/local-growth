import type { BusinessAim, TargetKey } from "../../config/onboarding";
import type { AnalysisPost, PostFormat } from "./posts";

/**
 * Insights → Overview (UX3), the pure parts: three key numbers for the last 7 days vs the 7 days
 * before, chosen from the business's goal, and a one-or-two-sentence weekly summary — all computed
 * here from stored posts and the daily follower counts (no AI, no new Instagram calls). Every number
 * carries how many posts it rests on; too little data is reported as such, never as a zero or a
 * guess. Pure (no server-only) so it can be unit-tested.
 */

const DAY = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export const OVERVIEW_METRICS = ["reach", "shares", "saves", "comments", "interactions", "newFollowers"] as const;
export type OverviewMetricKey = (typeof OVERVIEW_METRICS)[number];

/** Posts each week needs before a percentage change is shown (one or two posts either side is chance, not a trend). */
export const OVERVIEW_MIN_POSTS = 3;
/** Posts over the two weeks before the summary appears. */
export const SUMMARY_MIN_POSTS = 2;
/** The period "X did best" looks at: both weeks together, for a bigger sample. */
export const BEST_FORMAT_DAYS = 14;
/** Below this the week before is too small for a percentage (5 → 10 shares is not "+100%"). */
export const OVERVIEW_MIN_BASE: Record<Exclude<OverviewMetricKey, "newFollowers">, number> = { reach: 100, shares: 5, saves: 5, comments: 5, interactions: 10 };
/** A change smaller than this (either way) reads as "about the same". */
export const OVERVIEW_FLAT_PCT = 5;
/** "X did best" needs this many posts of that type and a lead of at least this much over the next type. */
export const BEST_FORMAT_MIN_POSTS = 2;
export const BEST_FORMAT_MIN_LEAD_PCT = 10;

/** The three numbers for each goal, most telling first. Profile visits aren't here: Instagram only gives them as 30-day totals. */
const BY_GOAL: Record<TargetKey | BusinessAim | "default", OverviewMetricKey[]> = {
  followers: ["newFollowers", "reach", "shares"],
  more_followers: ["newFollowers", "reach", "shares"],
  sales: ["reach", "shares", "saves"],
  more_customers: ["reach", "shares", "saves"],
  visits: ["reach", "saves", "shares"],
  more_visits: ["reach", "saves", "shares"],
  messages: ["reach", "comments", "shares"],
  more_engagement: ["interactions", "shares", "saves"],
  brand_awareness: ["reach", "shares", "newFollowers"],
  default: ["reach", "interactions", "newFollowers"],
};
/** Stand-ins when Instagram doesn't report one of the goal's metrics for this account (e.g. shares). */
const FALLBACK: OverviewMetricKey[] = ["reach", "interactions", "newFollowers", "saves", "comments"];

export type OverviewGoal = TargetKey | BusinessAim | null;

export interface OverviewPeriod {
  /** ISO: the last 7 days are [start, end), the 7 days before [previousStart, start). */
  start: string;
  end: string;
  previousStart: string;
}

export interface OverviewMetric {
  key: OverviewMetricKey;
  /**
   * "ok": both weeks have enough data — value and change.
   * "no_compare": this week's value, but the week before is too thin or too small for a change.
   * "not_enough": nothing to show for the last 7 days.
   */
  state: "ok" | "no_compare" | "not_enough";
  /** Total for the 7 days (reach/shares/saves/comments of the posts published in it), the average per post (interactions) or the net new followers. */
  current: number | null;
  previous: number | null;
  /** Percent vs the 7 days before; null unless "ok" (never for followers: a change of a change misleads). */
  changePct: number | null;
  /** Posts each number is based on (followers: 0). */
  posts: { current: number; previous: number };
}

export type SummaryLead =
  | { kind: "change"; metric: OverviewMetricKey; direction: "up" | "down" | "flat"; pct: number }
  | { kind: "followers"; change: number }
  | { kind: "posts"; current: number; previous: number };

export interface OverviewSummary {
  lead: SummaryLead;
  /** The post type with the most likes + comments per post over both weeks, when it clearly led. */
  best: { format: PostFormat; avgInteractions: number; posts: number; leadPct: number } | null;
  /** Posts the summary rests on. */
  posts: { current: number; previous: number };
}

export interface InsightsOverview {
  period: OverviewPeriod;
  /** The goal the numbers were picked for (first onboarding target, else the main aim), null = default set. */
  goal: OverviewGoal;
  metrics: OverviewMetric[];
  /** Null when the two weeks have fewer than SUMMARY_MIN_POSTS posts between them. */
  summary: OverviewSummary | null;
}

export function overviewPeriod(now: number): { start: number; end: number; previousStart: number } {
  return { end: now, start: now - 7 * DAY, previousStart: now - 14 * DAY };
}

/** Net follower change over [from, to): the last daily count before `to` minus the last one before `from`. */
export function followerDelta(series: Array<{ date: string; followers: number }>, from: number, to: number): number | null {
  const at = (t: number) => {
    let last: { date: string; followers: number } | null = null;
    for (const p of series) if (Date.parse(p.date) < t && (!last || p.date >= last.date)) last = p;
    return last;
  };
  const start = at(from);
  const end = at(to);
  if (!start || !end || start.date === end.date) return null;
  return end.followers - start.followers;
}

type PostMetric = Exclude<OverviewMetricKey, "newFollowers">;
const valueOf = (p: AnalysisPost, key: PostMetric): number | null => (key === "interactions" ? p.likes + p.comments : key === "comments" ? p.comments : p[key]);

function aggregate(posts: AnalysisPost[], key: PostMetric): { value: number | null; posts: number } {
  const values = posts.map((p) => valueOf(p, key)).filter((v): v is number => v !== null);
  if (!values.length) return { value: null, posts: 0 };
  const total = values.reduce((a, b) => a + b, 0);
  return { value: key === "interactions" ? round1(total / values.length) : total, posts: values.length };
}

export function pctChange(current: number, previous: number): number {
  return round1(((current - previous) / previous) * 100);
}

function postMetric(key: PostMetric, week: AnalysisPost[], prev: AnalysisPost[]): OverviewMetric {
  const cur = aggregate(week, key);
  const before = aggregate(prev, key);
  const posts = { current: cur.posts, previous: before.posts };
  if (cur.value === null || cur.posts === 0) return { key, state: "not_enough", current: null, previous: before.value, changePct: null, posts };
  const comparable = cur.posts >= OVERVIEW_MIN_POSTS && before.posts >= OVERVIEW_MIN_POSTS && before.value !== null && before.value >= OVERVIEW_MIN_BASE[key];
  return { key, state: comparable ? "ok" : "no_compare", current: cur.value, previous: before.value, changePct: comparable ? pctChange(cur.value, before.value!) : null, posts };
}

function followersMetric(series: Array<{ date: string; followers: number }>, p: { start: number; end: number; previousStart: number }): OverviewMetric {
  const current = followerDelta(series, p.start, p.end);
  const previous = followerDelta(series, p.previousStart, p.start);
  const posts = { current: 0, previous: 0 };
  if (current === null) return { key: "newFollowers", state: "not_enough", current: null, previous, changePct: null, posts };
  return { key: "newFollowers", state: previous === null ? "no_compare" : "ok", current, previous, changePct: null, posts };
}

/** Which metrics the goal asks for, swapping out any this account never reports (e.g. no share counts). */
export function pickMetrics(goal: OverviewGoal, reported: (key: OverviewMetricKey) => boolean): OverviewMetricKey[] {
  const wanted = BY_GOAL[goal ?? "default"] ?? BY_GOAL.default;
  const picked = wanted.filter(reported);
  for (const key of [...wanted, ...FALLBACK]) {
    if (picked.length >= 3) break;
    if (!picked.includes(key) && reported(key)) picked.push(key);
  }
  // Nothing reported at all (not connected, no posts): still the goal's three, each saying "not enough data".
  for (const key of wanted) if (picked.length < 3 && !picked.includes(key)) picked.push(key);
  return picked.slice(0, 3);
}

function bestFormat(posts: AnalysisPost[]): OverviewSummary["best"] {
  const by = new Map<PostFormat, number[]>();
  for (const p of posts) by.set(p.format, [...(by.get(p.format) ?? []), p.likes + p.comments]);
  const ranked = [...by]
    .map(([format, list]) => ({ format, posts: list.length, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);
  if (ranked.length < 2) return null;
  const [first, second] = ranked;
  if (first.posts < BEST_FORMAT_MIN_POSTS || second.avg <= 0) return null;
  const leadPct = Math.round(((first.avg - second.avg) / second.avg) * 100);
  if (leadPct < BEST_FORMAT_MIN_LEAD_PCT) return null;
  return { format: first.format, avgInteractions: Math.round(first.avg), posts: first.posts, leadPct };
}

function summaryOf(metrics: OverviewMetric[], week: AnalysisPost[], prev: AnalysisPost[]): OverviewSummary | null {
  const posts = { current: week.length, previous: prev.length };
  if (posts.current + posts.previous < SUMMARY_MIN_POSTS) return null;
  const changed = metrics.find((m) => m.state === "ok" && m.changePct !== null);
  const followers = metrics.find((m) => m.key === "newFollowers" && m.current !== null);
  let lead: SummaryLead;
  if (followers && metrics[0] === followers) {
    // The goal is followers: lead with them.
    lead = { kind: "followers", change: followers.current! };
  } else if (changed) {
    const pct = changed.changePct!;
    lead = { kind: "change", metric: changed.key, direction: Math.abs(pct) < OVERVIEW_FLAT_PCT ? "flat" : pct > 0 ? "up" : "down", pct: Math.abs(pct) };
  } else if (followers) {
    lead = { kind: "followers", change: followers.current! };
  } else {
    lead = { kind: "posts", current: posts.current, previous: posts.previous };
  }
  return { lead, best: bestFormat([...week, ...prev]), posts };
}

export function computeOverview(input: {
  posts: AnalysisPost[];
  followerSeries: Array<{ date: string; followers: number }>;
  goal: OverviewGoal;
  now: number;
}): InsightsOverview {
  const p = overviewPeriod(input.now);
  const within = (from: number, to: number) => input.posts.filter((post) => {
    const t = Date.parse(post.postedAt);
    return t >= from && t < to;
  });
  const week = within(p.start, p.end);
  const prev = within(p.previousStart, p.start);
  const both = [...week, ...prev];
  const metricOf = (key: OverviewMetricKey) => (key === "newFollowers" ? followersMetric(input.followerSeries, p) : postMetric(key, week, prev));
  // A metric is "reported" when Instagram gave it for at least one post of the two weeks (followers: two daily counts).
  const reported = (key: OverviewMetricKey) =>
    key === "newFollowers" ? followerDelta(input.followerSeries, p.start, p.end) !== null || followerDelta(input.followerSeries, p.previousStart, p.start) !== null : both.some((post) => valueOf(post, key) !== null);
  const metrics = pickMetrics(input.goal, reported).map(metricOf);
  return {
    period: { start: new Date(p.start).toISOString(), end: new Date(p.end).toISOString(), previousStart: new Date(p.previousStart).toISOString() },
    goal: input.goal,
    metrics,
    summary: summaryOf(metrics, week, prev),
  };
}
