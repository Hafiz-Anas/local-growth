import type { Method } from "./methods";
import { dayPartOf, localWeekdayHour, type AnalysisPost, type DayPart, type PostFormat, type Weekday } from "./posts";

/**
 * Shareability: how often people send a post to friends, as shares ÷ reach (Instagram ranks posts
 * heavily on sends). Pure; tested in tests/shareability.test.ts.
 *
 * Both numbers are Instagram's lifetime post insights (measured; reach is Meta's estimate). A post
 * reached by fewer than SHARE_MIN_REACH accounts is left out: one share among 50 people would
 * look like a 2% hit. Averages are pooled (all shares ÷ all reach), so a tiny post can't swing them.
 */

/** Posts reached by fewer accounts get no share rate (too few people to say anything). */
export const SHARE_MIN_REACH = 100;
/** Posts with a share rate needed before an average, a ranking or "Most shared" is shown. */
export const SHARE_MIN_POSTS = 3;
/** Posts with a share rate needed before most- vs least-shared patterns are looked for. */
export const SHARE_MIN_POSTS_FOR_PATTERNS = 6;
/** Posts listed in "Most shared". */
export const MOST_SHARED_COUNT = 3;
/** A group (format, topic, day, time) needs this many posts to count as a pattern. */
export const PATTERN_MIN_POSTS = 2;
/** A group this far above (or below 1 / this) the account's average is a pattern worth telling. */
export const PATTERN_MIN_RATIO = 1.3;
/** Day and time of day are noisier than what a post is, and less to act on: they count for less. */
const DIMENSION_WEIGHT = { format: 1, topic: 1, weekday: 0.6, dayPart: 0.6 } as const;

export type ShareRate = { status: "ok"; rate: number } | { status: "low_reach" | "unavailable"; rate: null };

/** shares ÷ reach, or why there is none: no numbers from Instagram, or too little reach. */
export function shareRate(post: Pick<AnalysisPost, "shares" | "reach">): ShareRate {
  if (post.shares === null || post.reach === null || post.reach <= 0) return { status: "unavailable", rate: null };
  if (post.reach < SHARE_MIN_REACH) return { status: "low_reach", rate: null };
  return { status: "ok", rate: post.shares / post.reach };
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
/** A rate as a percent with two decimals (0.0127 → 1.27). */
export const ratePct = (rate: number) => round(rate * 100, 2);
/** How many times the average, one decimal ("2.3x"); null without an average. */
export function timesAverage(rate: number, average: number | null): number | null {
  return average && average > 0 ? round(rate / average, 1) : null;
}

export interface SharePost {
  id: string;
  format: PostFormat;
  topic: Method | null;
  postedAt: string;
  caption: string;
  shares: number;
  reach: number;
  /** shares ÷ reach as a percent, two decimals. */
  ratePct: number;
  /** Times the account's average (pooled), one decimal. */
  vsAverage: number | null;
  weekday: Weekday;
  dayPart: DayPart;
}

export interface ShareGroup<K extends string> {
  key: K;
  posts: number;
  shares: number;
  reach: number;
  ratePct: number;
  vsAverage: number | null;
}

export interface ShareabilityData {
  /** Posts with a share rate. */
  posts: number;
  excluded: { lowReach: number; unavailable: number };
  /** Pooled: all shares ÷ all reach of the posts with a share rate; null below SHARE_MIN_POSTS. */
  averagePct: number | null;
  /** The same, unrounded (comparisons use this). */
  averageRate: number | null;
  totalShares: number;
  totalReach: number;
  /** Every post with a share rate, most shared first. */
  ranked: SharePost[];
  /** "Most shared": the top MOST_SHARED_COUNT, once there are SHARE_MIN_POSTS posts. */
  mostShared: SharePost[];
  /** The most- and least-shared third (≥ SHARE_MIN_POSTS_FOR_PATTERNS posts), for the patterns. */
  top: SharePost[];
  bottom: SharePost[];
  groups: {
    format: Array<ShareGroup<PostFormat>>;
    topic: Array<ShareGroup<Method>>;
    weekday: Array<ShareGroup<Weekday>>;
    dayPart: Array<ShareGroup<DayPart>>;
  };
}

function groupBy<K extends string>(posts: SharePost[], keyOf: (p: SharePost) => K | null, average: number | null): Array<ShareGroup<K>> {
  const map = new Map<K, { posts: number; shares: number; reach: number }>();
  for (const p of posts) {
    const key = keyOf(p);
    if (key === null) continue;
    const g = map.get(key) ?? { posts: 0, shares: 0, reach: 0 };
    map.set(key, { posts: g.posts + 1, shares: g.shares + p.shares, reach: g.reach + p.reach });
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, ...g, ratePct: ratePct(g.shares / g.reach), vsAverage: timesAverage(g.shares / g.reach, average) }))
    .sort((a, b) => b.ratePct - a.ratePct || b.posts - a.posts);
}

/** Every number about the account's shares. `topicOf`: the post's marketing method (stored or from the caption). */
export function computeShareability(posts: AnalysisPost[], { timeZone, topicOf = () => null }: { timeZone: string; topicOf?: (post: AnalysisPost) => Method | null }): ShareabilityData {
  const excluded = { lowReach: 0, unavailable: 0 };
  const rated: Array<{ post: AnalysisPost; rate: number }> = [];
  for (const post of posts) {
    const r = shareRate(post);
    if (r.status === "ok") rated.push({ post, rate: r.rate });
    else if (r.status === "low_reach") excluded.lowReach += 1;
    else excluded.unavailable += 1;
  }
  const totalShares = rated.reduce((n, r) => n + r.post.shares!, 0);
  const totalReach = rated.reduce((n, r) => n + r.post.reach!, 0);
  const average = rated.length >= SHARE_MIN_POSTS && totalReach > 0 ? totalShares / totalReach : null;

  // Ties: more shares first, then newest.
  const sorted = [...rated].sort((a, b) => b.rate - a.rate || b.post.shares! - a.post.shares! || b.post.postedAt.localeCompare(a.post.postedAt));
  const ranked: SharePost[] = sorted.map(({ post, rate }) => {
    const local = localWeekdayHour(post.postedAt, timeZone);
    return {
      id: post.id,
      format: post.format,
      topic: topicOf(post),
      postedAt: post.postedAt,
      caption: post.caption,
      shares: post.shares!,
      reach: post.reach!,
      ratePct: ratePct(rate),
      vsAverage: timesAverage(rate, average),
      weekday: local.weekday,
      dayPart: dayPartOf(local.hour),
    };
  });

  const third = ranked.length >= SHARE_MIN_POSTS_FOR_PATTERNS ? Math.max(2, Math.floor(ranked.length / 3)) : 0;
  return {
    posts: ranked.length,
    excluded,
    averagePct: average === null ? null : ratePct(average),
    averageRate: average,
    totalShares,
    totalReach,
    ranked,
    mostShared: average === null ? [] : ranked.slice(0, MOST_SHARED_COUNT),
    top: third ? ranked.slice(0, third) : [],
    bottom: third ? ranked.slice(-third).reverse() : [],
    groups: {
      format: groupBy(ranked, (p) => p.format, average),
      topic: groupBy(ranked, (p) => p.topic, average),
      weekday: groupBy(ranked, (p) => p.weekday, average),
      dayPart: groupBy(ranked, (p) => p.dayPart, average),
    },
  };
}

export type PatternDimension = keyof ShareabilityData["groups"];

export interface SharePattern {
  dimension: PatternDimension;
  key: string;
  direction: "above" | "below";
  group: ShareGroup<string>;
}

/**
 * Groups that stand out from the account's average (≥ PATTERN_MIN_RATIO times, or below 1 / that),
 * with at least PATTERN_MIN_POSTS posts: what gets shared more first (that's what to post next), then
 * what gets shared less; strongest first within each (ratio weighted by how many posts back it, and
 * day / time of day counting for less than post type and topic).
 * What the mock writes its findings from, and a hint list for the AI.
 */
export function sharePatterns(data: ShareabilityData): SharePattern[] {
  if (data.posts < SHARE_MIN_POSTS_FOR_PATTERNS || data.averagePct === null) return [];
  const out: Array<{ pattern: SharePattern; score: number }> = [];
  for (const dimension of ["format", "topic", "weekday", "dayPart"] as const) {
    const groups = data.groups[dimension] as Array<ShareGroup<string>>;
    // A group that is every post isn't a pattern ("all your posts are photos").
    for (const group of groups) {
      if (group.posts < PATTERN_MIN_POSTS || group.posts === data.posts || group.vsAverage === null) continue;
      const ratio = group.vsAverage;
      const direction = ratio >= PATTERN_MIN_RATIO ? "above" : ratio > 0 && ratio <= 1 / PATTERN_MIN_RATIO ? "below" : null;
      if (!direction) continue;
      out.push({ pattern: { dimension, key: group.key, direction, group }, score: Math.abs(Math.log(Math.max(ratio, 0.01))) * Math.sqrt(group.posts) * DIMENSION_WEIGHT[dimension] });
    }
  }
  const rank = (o: { pattern: SharePattern }) => (o.pattern.direction === "above" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.score - a.score).map((o) => o.pattern);
}

/** One post's share rate for its detail page, against the account's average. */
export interface PostShareRate {
  status: ShareRate["status"];
  ratePct: number | null;
  shares: number | null;
  reach: number | null;
  averagePct: number | null;
  vsAverage: number | null;
  basedOn: number;
}

export function postShareRate(post: AnalysisPost, data: ShareabilityData): PostShareRate {
  const r = shareRate(post);
  return {
    status: r.status,
    ratePct: r.rate === null ? null : ratePct(r.rate),
    shares: post.shares,
    reach: post.reach,
    averagePct: data.averagePct,
    vsAverage: r.rate === null ? null : timesAverage(r.rate, data.averageRate),
    basedOn: data.posts,
  };
}
