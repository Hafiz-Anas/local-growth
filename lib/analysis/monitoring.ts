import { interactions } from "./posts";

/**
 * "Monitor this post": durations, how often a monitored post is read, its readings as a series,
 * notable-change alerts against the account's average and the final numbers when monitoring
 * ends. Only measured numbers: a metric Instagram didn't report is null and never estimated.
 * Pure (shared by the server and the UI); tested in tests/monitoring.test.ts.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const MONITOR_DURATIONS = ["2h", "6h", "24h", "3d", "7d", "30d", "90d", "1y"] as const;
export type MonitorDuration = (typeof MONITOR_DURATIONS)[number];

export const DURATION_MS: Record<MonitorDuration, number> = {
  "2h": 2 * HOUR,
  "6h": 6 * HOUR,
  "24h": 24 * HOUR,
  "3d": 3 * DAY,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  "90d": 90 * DAY,
  "1y": 365 * DAY,
};

export const isMonitorDuration = (value: unknown): value is MonitorDuration => typeof value === "string" && (MONITOR_DURATIONS as readonly string[]).includes(value);

/** Monitoring up to this long is read every hour; longer monitoring once a day. */
export const HOURLY_MAX_MS = 3 * DAY;
/** A monitor never runs for more than a year from now (extending past that is capped). */
export const MAX_MONITOR_MS = 365 * DAY;

export type MonitorInterval = "hourly" | "daily";

export const intervalFor = (totalMs: number): MonitorInterval => (totalMs <= HOURLY_MAX_MS ? "hourly" : "daily");
export const INTERVAL_MS: Record<MonitorInterval, number> = { hourly: HOUR, daily: DAY };

/** New end after extending by `duration`: from the current end (or now, if that has passed), capped at a year from now. */
export function extendedEnd(endsAt: number, duration: MonitorDuration, now = Date.now()): number {
  return Math.min(Math.max(endsAt, now) + DURATION_MS[duration], now + MAX_MONITOR_MS);
}

// ── Readings ────────────────────────────────────────────────────────────────────

export const READING_METRICS = ["likes", "comments", "reach", "saves", "shares", "views"] as const;
export type ReadingMetric = (typeof READING_METRICS)[number];

export interface Reading {
  /** ISO time the numbers were read. */
  at: string;
  likes: number;
  comments: number;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  views: number | null;
}

export interface MonitorPoint extends Reading {
  interactions: number;
}

/** A daily PostSnapshot row (Post performance's history), reused for daily monitoring. */
export interface DailyRow extends Omit<Reading, "at"> {
  /** YYYY-MM-DD (UTC) */
  date: string;
  takenAt: string;
}

/**
 * The monitor's points, oldest first: hourly readings, plus the daily snapshots of days without an
 * hourly reading, between the start and the end (or now).
 */
export function monitorSeries(hourly: Reading[], daily: DailyRow[], startedAt: string, until: string): MonitorPoint[] {
  const from = startedAt.slice(0, 10);
  const to = until.slice(0, 10);
  const hourlyDays = new Set(hourly.map((r) => r.at.slice(0, 10)));
  const fromDaily = daily
    .filter((d) => d.date >= from && d.date <= to && !hourlyDays.has(d.date))
    .map((d) => ({ at: d.takenAt, likes: d.likes, comments: d.comments, reach: d.reach, saves: d.saves, shares: d.shares, views: d.views }));
  return [...hourly, ...fromDaily]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((r) => ({ ...r, interactions: interactions(r) }));
}

/** At most `max` points, evenly picked (always keeping the first and the last), for a mini chart. */
export function sparkline(points: MonitorPoint[], max = 24): number[] {
  if (points.length <= max) return points.map((p) => p.interactions);
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)].interactions);
}

// ── Notable changes ─────────────────────────────────────────────────────────────

/** The account's averages when monitoring started: the yardstick for alerts and the summary. */
export interface MonitorBaseline {
  /** Average likes + comments per post over the account's other recent posts. */
  avgInteractions: number | null;
  /** Average reach of those posts that have it. */
  avgReach: number | null;
  /** How many posts the averages are based on. */
  basedOn: number;
}

export type AlertMetric = "interactions" | "reach";
/** Levels already alerted: the highest multiple of the average reached per metric, and whether a "below" alert went out. */
export type MonitorAlerts = Partial<Record<AlertMetric, number>> & { below?: boolean };

/** Multiples of the average that send an alert (each once). */
export const SPIKE_LEVELS = [1.5, 2, 3, 5] as const;
/** Below this share of the average, after DROP_MIN_AGE_MS since posting, one "below average" alert. */
export const DROP_SHARE = 0.5;
export const DROP_MIN_AGE_MS = DAY;
/** Averages from fewer posts than this send no alerts (not a meaningful comparison). */
export const MIN_BASELINE_POSTS = 3;
/** Smallest absolute difference worth an alert (small accounts swing a lot in percent). */
const MIN_DIFF: Record<AlertMetric, number> = { interactions: 10, reach: 50 };

export interface NotableChange {
  kind: "above" | "below";
  metric: AlertMetric;
  /** The multiple crossed (above) or DROP_SHARE (below). */
  level: number;
  value: number;
  average: number;
  /** Percent above (+) or below (−) the average, rounded. */
  pct: number;
}

const metricValue = (r: Reading, m: AlertMetric): number | null => (m === "interactions" ? interactions(r) : r.reach !== null && r.reach > 0 ? r.reach : null);
const metricAverage = (b: MonitorBaseline, m: AlertMetric) => (m === "interactions" ? b.avgInteractions : b.avgReach);

/**
 * The alert this reading calls for, if any: the post crossed a new multiple of the account's
 * average (likes + comments first, then reach), or — a day after posting — is still below half
 * of it. Each level is alerted once (`alerts` holds what was sent).
 */
export function notableChange(reading: Reading, baseline: MonitorBaseline, alerts: MonitorAlerts, postedAt: string, now = Date.now()): NotableChange | null {
  if (baseline.basedOn < MIN_BASELINE_POSTS) return null;
  for (const metric of ["interactions", "reach"] as const) {
    const value = metricValue(reading, metric);
    const average = metricAverage(baseline, metric);
    if (value === null || average === null || average <= 0) continue;
    const level = [...SPIKE_LEVELS].reverse().find((l) => value >= average * l);
    if (level && level > (alerts[metric] ?? 0) && value - average >= MIN_DIFF[metric]) {
      return { kind: "above", metric, level, value, average, pct: Math.round(((value - average) / average) * 100) };
    }
  }
  const value = metricValue(reading, "interactions");
  const average = baseline.avgInteractions;
  if (!alerts.below && value !== null && average && now - Date.parse(postedAt) >= DROP_MIN_AGE_MS && value <= average * DROP_SHARE && average - value >= MIN_DIFF.interactions) {
    return { kind: "below", metric: "interactions", level: DROP_SHARE, value, average, pct: Math.round(((value - average) / average) * 100) };
  }
  return null;
}

/** `alerts` after sending `change`. */
export function withAlert(alerts: MonitorAlerts, change: NotableChange): MonitorAlerts {
  return change.kind === "below" ? { ...alerts, below: true } : { ...alerts, [change.metric]: change.level };
}

// ── The end ─────────────────────────────────────────────────────────────────────

export interface MonitorOutcome {
  startedAt: string;
  endedAt: string;
  /** How many readings the numbers are based on. */
  readings: number;
  first: MonitorPoint | null;
  last: MonitorPoint | null;
  /** Change between the first and the last reading, per metric both report. */
  gained: Partial<Record<ReadingMetric | "interactions", number>>;
  /** The last reading vs the account's average. */
  vsAverage: Partial<Record<AlertMetric, { value: number; average: number; pct: number }>>;
  /** Between which two readings likes + comments grew the most. */
  peak: { from: string; to: string; gained: number } | null;
  baselinePosts: number;
}

export function monitorOutcome(points: MonitorPoint[], baseline: MonitorBaseline, startedAt: string, endedAt: string): MonitorOutcome {
  const first = points[0] ?? null;
  const last = points.at(-1) ?? null;
  const gained: MonitorOutcome["gained"] = {};
  if (first && last && points.length >= 2) {
    for (const m of [...READING_METRICS, "interactions"] as const) {
      const a = first[m];
      const b = last[m];
      if (typeof a === "number" && typeof b === "number") gained[m] = b - a;
    }
  }
  const vsAverage: MonitorOutcome["vsAverage"] = {};
  if (last && baseline.basedOn > 0) {
    for (const metric of ["interactions", "reach"] as const) {
      const value = metricValue(last, metric);
      const average = metricAverage(baseline, metric);
      if (value !== null && average !== null && average > 0) vsAverage[metric] = { value, average, pct: Math.round(((value - average) / average) * 100) };
    }
  }
  let peak: MonitorOutcome["peak"] = null;
  for (let i = 1; i < points.length; i++) {
    const g = points[i].interactions - points[i - 1].interactions;
    if (g > 0 && (!peak || g > peak.gained)) peak = { from: points[i - 1].at, to: points[i].at, gained: g };
  }
  return { startedAt, endedAt, readings: points.length, first, last, gained, vsAverage, peak, baselinePosts: baseline.basedOn };
}
