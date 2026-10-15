import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DURATION_MS,
  MONITOR_DURATIONS,
  extendedEnd,
  intervalFor,
  isMonitorDuration,
  monitorOutcome,
  monitorSeries,
  notableChange,
  sparkline,
  withAlert,
  type MonitorBaseline,
  type Reading,
} from "../lib/analysis/monitoring";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-15T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const reading = (at: number, over: Partial<Reading> = {}): Reading => ({ at: iso(at), likes: 100, comments: 10, reach: null, saves: null, shares: null, views: null, ...over });
const baseline: MonitorBaseline = { avgInteractions: 100, avgReach: 1000, basedOn: 10 };

describe("durations and intervals", () => {
  it("offers the eight durations, hourly up to 3 days and daily after", () => {
    assert.deepEqual([...MONITOR_DURATIONS], ["2h", "6h", "24h", "3d", "7d", "30d", "90d", "1y"]);
    assert.deepEqual(
      MONITOR_DURATIONS.map((d) => intervalFor(DURATION_MS[d])),
      ["hourly", "hourly", "hourly", "hourly", "daily", "daily", "daily", "daily"],
    );
    assert.ok(isMonitorDuration("7d"));
    assert.ok(!isMonitorDuration("5d"));
    assert.equal(DURATION_MS["1y"], 365 * DAY);
  });

  it("extends from the current end, or from now when it has passed, capped at a year from now", () => {
    assert.equal(extendedEnd(NOW + 2 * HOUR, "6h", NOW), NOW + 8 * HOUR);
    assert.equal(extendedEnd(NOW - HOUR, "24h", NOW), NOW + DAY);
    assert.equal(extendedEnd(NOW + 300 * DAY, "1y", NOW), NOW + 365 * DAY);
  });
});

describe("the series", () => {
  const start = Date.parse("2026-10-10T09:30:00Z");

  it("merges hourly readings with the daily snapshots of days that have no hourly reading", () => {
    const hourly = [reading(start, { likes: 10 }), reading(start + HOUR, { likes: 20 })];
    const daily = [
      { date: "2026-10-09", takenAt: "2026-10-09T03:00:00Z", likes: 1, comments: 0, reach: null, saves: null, shares: null, views: null }, // before the start
      { date: "2026-10-10", takenAt: "2026-10-10T23:00:00Z", likes: 25, comments: 1, reach: null, saves: null, shares: null, views: null }, // covered by hourly
      { date: "2026-10-11", takenAt: "2026-10-11T03:00:00Z", likes: 40, comments: 2, reach: 500, saves: null, shares: null, views: null },
      { date: "2026-10-20", takenAt: "2026-10-20T03:00:00Z", likes: 90, comments: 2, reach: 500, saves: null, shares: null, views: null }, // after the end
    ];
    const points = monitorSeries(hourly, daily, iso(start), "2026-10-12T00:00:00Z");
    assert.deepEqual(points.map((p) => p.likes), [10, 20, 40]);
    assert.deepEqual(points.map((p) => p.interactions), [20, 30, 42]);
    assert.equal(points[2].at, "2026-10-11T03:00:00Z");
  });

  it("thins long series for the mini chart, keeping both ends", () => {
    const points = monitorSeries(Array.from({ length: 100 }, (_, i) => reading(start + i * HOUR, { likes: i, comments: 0 })), [], iso(start), iso(start + 100 * HOUR));
    const spark = sparkline(points, 24);
    assert.equal(spark.length, 24);
    assert.equal(spark[0], 0);
    assert.equal(spark.at(-1), 99);
    assert.deepEqual(sparkline(points.slice(0, 3)), [0, 1, 2]);
  });
});

describe("notable changes", () => {
  const postedAt = iso(NOW - 2 * HOUR);

  it("alerts once per multiple of the average, the highest one crossed", () => {
    const r = reading(NOW, { likes: 190, comments: 15 }); // 205 = 2.05 × average
    const change = notableChange(r, baseline, {}, postedAt, NOW);
    assert.deepEqual(change, { kind: "above", metric: "interactions", level: 2, value: 205, average: 100, pct: 105 });
    const alerts = withAlert({}, change!);
    assert.equal(notableChange(r, baseline, alerts, postedAt, NOW), null);
    // Crossing 3× later is a new alert.
    assert.equal(notableChange(reading(NOW, { likes: 300, comments: 10 }), baseline, alerts, postedAt, NOW)?.level, 3);
  });

  it("alerts on reach when likes + comments are ordinary", () => {
    const change = notableChange(reading(NOW, { likes: 90, comments: 5, reach: 1600 }), baseline, {}, postedAt, NOW);
    assert.equal(change?.metric, "reach");
    assert.equal(change?.level, 1.5);
    assert.equal(change?.pct, 60);
  });

  it("says nothing without enough posts to compare, or for tiny absolute differences", () => {
    assert.equal(notableChange(reading(NOW, { likes: 500 }), { ...baseline, basedOn: 2 }, {}, postedAt, NOW), null);
    assert.equal(notableChange(reading(NOW, { likes: 12, comments: 0 }), { avgInteractions: 6, avgReach: null, basedOn: 10 }, {}, postedAt, NOW), null);
  });

  it("only calls a post below average a day after it was posted, once", () => {
    const low = reading(NOW, { likes: 30, comments: 5 });
    assert.equal(notableChange(low, baseline, {}, postedAt, NOW), null);
    const dayOld = iso(NOW - 25 * HOUR);
    const change = notableChange(low, baseline, {}, dayOld, NOW);
    assert.deepEqual(change, { kind: "below", metric: "interactions", level: 0.5, value: 35, average: 100, pct: -65 });
    assert.equal(notableChange(low, baseline, withAlert({}, change!), dayOld, NOW), null);
  });

  it("treats a reach of 0 as not reported", () => {
    assert.equal(notableChange(reading(NOW, { likes: 90, comments: 5, reach: 0 }), baseline, {}, postedAt, NOW), null);
  });
});

describe("the outcome", () => {
  it("computes the change, the comparison and the fastest growth from the readings only", () => {
    const start = NOW - 3 * HOUR;
    const points = monitorSeries(
      [reading(start, { likes: 10, comments: 1, reach: 100 }), reading(start + HOUR, { likes: 50, comments: 5, reach: 600 }), reading(start + 2 * HOUR, { likes: 60, comments: 6, reach: null }), reading(start + 3 * HOUR, { likes: 70, comments: 8, reach: 900 })],
      [],
      iso(start),
      iso(NOW),
    );
    const o = monitorOutcome(points, baseline, iso(start), iso(NOW));
    assert.equal(o.readings, 4);
    assert.deepEqual(o.gained, { likes: 60, comments: 7, reach: 800, interactions: 67 });
    assert.deepEqual(o.vsAverage, { interactions: { value: 78, average: 100, pct: -22 }, reach: { value: 900, average: 1000, pct: -10 } });
    assert.deepEqual(o.peak, { from: iso(start), to: iso(start + HOUR), gained: 44 });
    assert.equal(o.baselinePosts, 10);
  });

  it("handles a monitor that ended before any reading", () => {
    const o = monitorOutcome([], baseline, iso(NOW - HOUR), iso(NOW));
    assert.equal(o.readings, 0);
    assert.equal(o.first, null);
    assert.deepEqual(o.gained, {});
    assert.equal(o.peak, null);
  });
});
