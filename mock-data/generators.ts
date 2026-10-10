import type { FollowerPoint } from "@/types";

/** Deterministic pseudo-random generator so mock charts are stable across renders. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** 30 daily follower counts ending on `endDate`, climbing from `start` to `end`. */
export function followerSeries(start: number, end: number, endDate: string, seed: number, days = 30): FollowerPoint[] {
  const rand = seeded(seed);
  const last = new Date(`${endDate}T00:00:00Z`);
  const step = (end - start) / (days - 1);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(last);
    date.setUTCDate(last.getUTCDate() - (days - 1 - i));
    const noise = i === 0 || i === days - 1 ? 0 : Math.round((rand() - 0.4) * step * 1.6);
    return { date: date.toISOString().slice(0, 10), followers: Math.round(start + step * i + noise) };
  });
}

/**
 * 7×24 engagement heatmap (Sunday → Saturday, 0–23h, values 0..1).
 * `peaks` are [hour, weight] pairs; weekend (Fri/Sat) evenings get a boost.
 */
export function engagementHeatmap(peaks: Array<[number, number]>, seed: number): number[][] {
  const rand = seeded(seed);
  return Array.from({ length: 7 }, (_, day) => {
    const weekend = day === 5 || day === 6;
    return Array.from({ length: 24 }, (_, hour) => {
      if (hour >= 2 && hour <= 6) return Math.round(rand() * 6) / 100;
      let v = 0.08;
      for (const [peak, weight] of peaks) {
        const dist = Math.abs(hour - peak);
        v += weight * Math.max(0, 1 - dist / 3);
      }
      if (weekend && hour >= 19) v += 0.15;
      if (weekend && hour < 11) v -= 0.1;
      v += (rand() - 0.5) * 0.12;
      return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    });
  });
}
