import type { FollowerPoint, MetricValue, PostWindow, WindowResult } from "@/types";
import { changePct, engagementRateOf, normalizeGrid, type AccountInsights } from "./mappers";

/**
 * Synced Meta data (account insights, posts with their insights, daily follower
 * snapshots) → the dashboard/experiment numbers InstagramService returns. Pure.
 * Anything Meta didn't give us comes back with `available: false` so the UI
 * says "Not available yet for this account" instead of showing a fake zero.
 */

export interface SyncedPost {
  postedAt: Date;
  likes: number;
  comments: number;
  /** Post insights by metric (reach, saved, …); missing keys = not available. */
  insights: Record<string, number>;
}

export interface Snapshot {
  date: string;
  followers: number;
}

const DAY = 24 * 60 * 60 * 1000;
const unavailable: MetricValue = { value: 0, changePct: 0, available: false };

/** Posting windows used for real accounts (business-local hours). Posts between 00:00 and 06:00 count as evening. */
export const META_WINDOWS: Array<{ id: PostWindow; startHour: number; endHour: number }> = [
  { id: "morning", startHour: 6, endHour: 12 },
  { id: "afternoon", startHour: 12, endHour: 18 },
  { id: "evening", startHour: 18, endHour: 24 },
];

/** Local hour (0–23) and weekday (0 = Sunday) of a moment in a time zone. */
export function localTime(date: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Sun");
  return { hour, weekday: Math.max(0, weekday) };
}

function windowOfHour(hour: number): PostWindow {
  return META_WINDOWS.find((w) => hour >= w.startHour && hour < w.endHour)?.id ?? "evening";
}

export function accountMetric(insights: AccountInsights | null, metric: keyof AccountInsights["current"]): MetricValue {
  const value = insights?.current[metric];
  if (value === undefined) return unavailable;
  return { value, changePct: changePct(value, insights?.previous[metric]) };
}

/** Average (likes + comments) per post ÷ followers over the last 30 days, vs. the 30 before. */
export function engagementMetric(posts: SyncedPost[], followers: number, now = Date.now()): MetricValue {
  const recent = posts.filter((p) => now - p.postedAt.getTime() <= 30 * DAY);
  const before = posts.filter((p) => now - p.postedAt.getTime() > 30 * DAY && now - p.postedAt.getTime() <= 60 * DAY);
  if (!recent.length || followers <= 0) return unavailable;
  const value = engagementRateOf(recent, followers);
  const previous = before.length ? engagementRateOf(before, followers) : null;
  return { value, changePct: changePct(value, previous) };
}

/**
 * New followers in the last 30 days: from Meta's follower_count (100+ followers)
 * or, failing that, from our own daily snapshots once they span a few days.
 */
export function followerGrowthMetric(insights: AccountInsights | null, snapshots: Snapshot[], now = Date.now()): MetricValue {
  const daily = insights?.followerDaily;
  if (daily?.length) return { value: daily.reduce((n, d) => n + d.value, 0), changePct: 0 };
  const recent = snapshots.filter((s) => now - Date.parse(`${s.date}T00:00:00Z`) <= 31 * DAY).sort((a, b) => a.date.localeCompare(b.date));
  if (recent.length < 2 || Date.parse(recent.at(-1)!.date) - Date.parse(recent[0].date) < 3 * DAY) return unavailable;
  return { value: recent.at(-1)!.followers - recent[0].followers, changePct: 0 };
}

/**
 * Follower history for the chart: our daily snapshots; while there are fewer
 * than a week of them, earlier days are estimated backwards from Meta's daily
 * new-follower counts (follower_count counts follows, not unfollows).
 */
export function followerSeries(snapshots: Snapshot[], insights: AccountInsights | null, currentFollowers: number): FollowerPoint[] {
  const own = [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const daily = insights?.followerDaily;
  if (own.length >= 7 || !daily?.length) return own.map((s) => ({ date: s.date, followers: s.followers }));
  const known = new Map(own.map((s) => [s.date, s.followers]));
  const days = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const series: FollowerPoint[] = [];
  let running = currentFollowers;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    series.unshift({ date: days[i].date, followers: known.get(days[i].date) ?? Math.max(0, running) });
    running -= days[i].value;
  }
  for (const s of own) if (!series.some((p) => p.date === s.date)) series.push({ date: s.date, followers: s.followers });
  return series.sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
}

/** Reach by posting window from posts of the last 60 days that have a reach insight. */
export function windowResults(posts: SyncedPost[], timeZone: string, now = Date.now()): { baselineReach: number; windows: WindowResult[] } {
  const withReach = posts.filter((p) => now - p.postedAt.getTime() <= 60 * DAY && typeof p.insights.reach === "number");
  const last30 = withReach.filter((p) => now - p.postedAt.getTime() <= 30 * DAY);
  const baseSet = last30.length ? last30 : withReach;
  const baselineReach = baseSet.length ? Math.round(baseSet.reduce((n, p) => n + p.insights.reach, 0) / baseSet.length) : 0;
  const windows = META_WINDOWS.map((w) => {
    const inWindow = withReach.filter((p) => windowOfHour(localTime(p.postedAt, timeZone).hour) === w.id);
    const avgReach = inWindow.length ? Math.round(inWindow.reduce((n, p) => n + p.insights.reach, 0) / inWindow.length) : 0;
    return { ...w, postsSampled: inWindow.length, avgReach, vsBaselinePct: inWindow.length && baselineReach ? changePct(avgReach, baselineReach) : 0 };
  });
  return { baselineReach, windows };
}

/** The window to suggest: the best one with at least 3 posts that beats the baseline. */
export function opportunityOf(windows: WindowResult[]) {
  const best = windows.filter((w) => w.postsSampled >= 3 && w.vsBaselinePct > 0).sort((a, b) => b.vsBaselinePct - a.vsBaselinePct)[0];
  if (!best) return null;
  return { window: best.id, liftPct: Math.round(best.vsBaselinePct), sampleSize: best.postsSampled, confidencePct: Math.min(95, 50 + best.postsSampled * 5) };
}

/**
 * 7×24 relative activity: Meta's online_followers when available, otherwise
 * engagement on the account's own posts by weekday and hour.
 */
export function heatmapOf(insights: AccountInsights | null, posts: SyncedPost[], timeZone: string): number[][] {
  if (insights?.onlineFollowers) return normalizeGrid(insights.onlineFollowers);
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const p of posts) {
    const { hour, weekday } = localTime(p.postedAt, timeZone);
    grid[weekday][hour] += p.likes + p.comments;
  }
  return normalizeGrid(grid);
}
