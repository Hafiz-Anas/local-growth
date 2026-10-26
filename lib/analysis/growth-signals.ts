import { dayPartOf, localWeekdayHour, type AnalysisPost, type DayPart, type PostFormat, type Weekday } from "./posts";
import type { ShareabilityData } from "./shareability";

/**
 * Growth signals for the weekly tips: where the business's own posts beat its own average on
 * what Instagram rewards — shares (sends), saves, comments and reach (by post type and by
 * posting day/time). Numbers only, computed in code; each signal carries its expected impact
 * (from the size of the lift and how many posts back it) so the tips are ranked in code, never
 * by the AI. Pure (no server imports); tested in tests/growth-signals.test.ts.
 */

export const SIGNAL_KINDS = ["shares", "saves", "comments", "reach_format", "reach_time"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const IMPACTS = ["high", "medium", "low"] as const;
export type Impact = (typeof IMPACTS)[number];
/** What a tip's 7-day result is measured on. */
export type SignalMetric = "shares" | "saves" | "comments" | "reach";

/** Posts with numbers the account needs before any signal is worth a tip. */
export const SIGNAL_MIN_ACCOUNT_POSTS = 4;
/** Posts a group (a post type, a day and time) needs to count. */
export const SIGNAL_MIN_GROUP_POSTS = 2;
/** A group must beat the account's average by at least this much (percent). */
export const SIGNAL_MIN_LIFT_PCT = 20;

/** Instagram ranks sends highest, then saves, then comments; reach is the result of all three. */
const KIND_WEIGHT: Record<SignalKind, number> = { shares: 1.3, saves: 1.2, comments: 1.1, reach_format: 1, reach_time: 1 };
const KIND_METRIC: Record<SignalKind, SignalMetric> = { shares: "shares", saves: "saves", comments: "comments", reach_format: "reach", reach_time: "reach" };

export interface GrowthSignal {
  /** "s1", "s2"… in rank order: how a tip names the signal it rests on. */
  id: string;
  kind: SignalKind;
  /** The post type (every kind but reach_time). */
  format: PostFormat | null;
  /** reach_time: the day (null when only the time of day stands out) and the time of day. */
  weekday: Weekday | null;
  dayPart: DayPart | null;
  /** The group's number and the account's: a rate in percent (shares, saves), per post (comments, reach). */
  value: number;
  average: number;
  unit: "pct" | "per_post";
  /** How far above the average, percent (whole number). */
  liftPct: number;
  posts: number;
  impact: Impact;
  metric: SignalMetric;
  score: number;
}

/** When the account usually does best, for the "when" of tips that aren't about timing. */
export interface BestSlot {
  weekday: Weekday | null;
  dayPart: DayPart;
}

export interface GrowthSignals {
  /** Posts that have Instagram's numbers (reach). */
  posts: number;
  signals: GrowthSignal[];
  bestSlot: BestSlot | null;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Expected impact: a big lift over enough posts is high; a small one, or one resting on 2 posts, low. */
export function impactOf(liftPct: number, posts: number): Impact {
  if (liftPct >= 50 && posts >= 4) return "high";
  if ((liftPct >= 25 && posts >= 3) || (liftPct >= 50 && posts >= SIGNAL_MIN_GROUP_POSTS)) return "medium";
  return "low";
}

const IMPACT_RANK: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
export const impactRank = (impact: Impact) => IMPACT_RANK[impact];

/** Highest impact first; within an impact, the stronger signal (lift × √posts × kind weight). */
export function rankSignals<T extends Pick<GrowthSignal, "impact" | "score">>(signals: T[]): T[] {
  return [...signals].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || b.score - a.score);
}

type Draft = Omit<GrowthSignal, "id" | "impact" | "metric" | "score">;

function finish(d: Draft): Omit<GrowthSignal, "id"> {
  return { ...d, impact: impactOf(d.liftPct, d.posts), metric: KIND_METRIC[d.kind], score: round(d.liftPct * Math.sqrt(d.posts) * KIND_WEIGHT[d.kind], 2) };
}

/** The best group by `value` that beats `average` enough, isn't every post, and has enough posts. */
function bestGroup<K extends string>(
  groups: Array<{ key: K; posts: number; value: number }>,
  average: number,
  total: number,
): { key: K; posts: number; value: number; liftPct: number } | null {
  if (!(average > 0)) return null;
  const best = groups
    .filter((g) => g.posts >= SIGNAL_MIN_GROUP_POSTS && g.posts < total)
    .map((g) => ({ ...g, liftPct: Math.round(((g.value - average) / average) * 100) }))
    .filter((g) => g.liftPct >= SIGNAL_MIN_LIFT_PCT)
    .sort((a, b) => b.liftPct * Math.sqrt(b.posts) - a.liftPct * Math.sqrt(a.posts));
  return best[0] ?? null;
}

function byFormat(posts: AnalysisPost[]): Map<PostFormat, AnalysisPost[]> {
  const map = new Map<PostFormat, AnalysisPost[]>();
  for (const p of posts) map.set(p.format, [...(map.get(p.format) ?? []), p]);
  return map;
}

/**
 * Every signal for the business's recent posts, ranked. `shareability`: the "Most shared"
 * numbers when the business has that feature (share rates per post type); without it there
 * are no share signals.
 */
export function computeGrowthSignals(posts: AnalysisPost[], { timeZone, shareability = null }: { timeZone: string; shareability?: ShareabilityData | null }): GrowthSignals {
  const reached = posts.filter((p) => p.reach !== null && p.reach > 0);
  if (reached.length < SIGNAL_MIN_ACCOUNT_POSTS) return { posts: reached.length, signals: [], bestSlot: null };
  const drafts: Draft[] = [];
  const formats = byFormat(reached);

  // Shares: the share rate per post type, from the "Most shared" numbers (pooled shares ÷ reach).
  if (shareability && shareability.averagePct !== null) {
    const best = bestGroup(
      shareability.groups.format.map((g) => ({ key: g.key, posts: g.posts, value: g.ratePct })),
      shareability.averagePct,
      shareability.posts,
    );
    if (best) drafts.push({ kind: "shares", format: best.key, weekday: null, dayPart: null, value: best.value, average: shareability.averagePct, unit: "pct", liftPct: best.liftPct, posts: best.posts });
  }

  // Saves: saves ÷ reach per post type, pooled, over posts Instagram reports saves for.
  const saved = reached.filter((p) => p.saves !== null);
  if (saved.length >= SIGNAL_MIN_ACCOUNT_POSTS) {
    const rate = (ps: AnalysisPost[]) => round((sum(ps.map((p) => p.saves!)) / sum(ps.map((p) => p.reach!))) * 100, 2);
    const average = rate(saved);
    const best = bestGroup(
      [...byFormat(saved)].map(([key, ps]) => ({ key, posts: ps.length, value: rate(ps) })),
      average,
      saved.length,
    );
    if (best) drafts.push({ kind: "saves", format: best.key, weekday: null, dayPart: null, value: best.value, average, unit: "pct", liftPct: best.liftPct, posts: best.posts });
  }

  // Comments per post by post type.
  const perPost = (ps: AnalysisPost[], of: (p: AnalysisPost) => number, digits: number) => round(sum(ps.map(of)) / ps.length, digits);
  const avgComments = perPost(reached, (p) => p.comments, 1);
  const comments = bestGroup(
    [...formats].map(([key, ps]) => ({ key, posts: ps.length, value: perPost(ps, (p) => p.comments, 1) })),
    avgComments,
    reached.length,
  );
  if (comments) drafts.push({ kind: "comments", format: comments.key, weekday: null, dayPart: null, value: comments.value, average: avgComments, unit: "per_post", liftPct: comments.liftPct, posts: comments.posts });

  // Reach per post by post type.
  const avgReach = perPost(reached, (p) => p.reach!, 0);
  const reachFormat = bestGroup(
    [...formats].map(([key, ps]) => ({ key, posts: ps.length, value: perPost(ps, (p) => p.reach!, 0) })),
    avgReach,
    reached.length,
  );
  if (reachFormat) drafts.push({ kind: "reach_format", format: reachFormat.key, weekday: null, dayPart: null, value: reachFormat.value, average: avgReach, unit: "per_post", liftPct: reachFormat.liftPct, posts: reachFormat.posts });

  // Reach by day and time of day (business timezone): a day + time slot when one has enough posts, else the time of day.
  const slots = new Map<string, { weekday: Weekday | null; dayPart: DayPart; posts: AnalysisPost[] }>();
  const parts = new Map<DayPart, AnalysisPost[]>();
  for (const p of reached) {
    const local = localWeekdayHour(p.postedAt, timeZone);
    const dayPart = dayPartOf(local.hour);
    const key = `${local.weekday}.${dayPart}`;
    const slot = slots.get(key) ?? { weekday: local.weekday, dayPart, posts: [] };
    slot.posts.push(p);
    slots.set(key, slot);
    parts.set(dayPart, [...(parts.get(dayPart) ?? []), p]);
  }
  const slotGroups = [...slots.entries()].map(([key, s]) => ({ key, posts: s.posts.length, value: perPost(s.posts, (p) => p.reach!, 0) }));
  const partGroups = [...parts.entries()].map(([key, ps]) => ({ key: key as string, posts: ps.length, value: perPost(ps, (p) => p.reach!, 0) }));
  const time = bestGroup(slotGroups, avgReach, reached.length) ?? bestGroup(partGroups, avgReach, reached.length);
  if (time) {
    const slot = slots.get(time.key);
    drafts.push({ kind: "reach_time", format: null, weekday: slot?.weekday ?? null, dayPart: slot?.dayPart ?? (time.key as DayPart), value: time.value, average: avgReach, unit: "per_post", liftPct: time.liftPct, posts: time.posts });
  }

  // The usual best slot (even below the lift threshold), so every tip can say when.
  const top = [...slotGroups].filter((g) => g.posts >= SIGNAL_MIN_GROUP_POSTS).sort((a, b) => b.value - a.value)[0];
  const topPart = [...partGroups].sort((a, b) => b.value - a.value || b.posts - a.posts)[0];
  const bestSlot: BestSlot | null = top ? { weekday: slots.get(top.key)!.weekday, dayPart: slots.get(top.key)!.dayPart } : topPart ? { weekday: null, dayPart: topPart.key as DayPart } : null;

  const signals = rankSignals(drafts.map(finish)).map((s, i) => ({ id: `s${i + 1}`, ...s }));
  return { posts: reached.length, signals, bestSlot };
}
