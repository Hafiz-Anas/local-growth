import { kuwaitAt } from "@/mock-data/gallery/clock";
import { TIME_SLOTS } from "@/mock-data/gallery/insights";
import type { Insights } from "@/mock-data/gallery/types";

/** AI-suggested time for the next post: tomorrow's (Saturday's) strongest slot. */
export function suggestedTime(ins: Pick<Insights, "bestTimes">) {
  const saturday = ins.bestTimes[0];
  const hour = TIME_SLOTS[saturday.indexOf(Math.max(...saturday))] % 24;
  return hour === 0 ? kuwaitAt(1, 23, 30) : kuwaitAt(1, hour, hour >= 18 ? 30 : 0);
}

/** A few alternative slots for the schedule picker. */
export function alternativeTimes(ins: Pick<Insights, "bestTimes">) {
  const cells: { day: number; slot: number; v: number }[] = [];
  ins.bestTimes.forEach((row, day) => row.forEach((v, slot) => cells.push({ day, slot, v })));
  return cells
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((c) => {
      const hour = TIME_SLOTS[c.slot] % 24;
      return hour === 0 ? kuwaitAt(c.day + 1, 23, 30) : kuwaitAt(c.day + 1, hour);
    })
    .sort();
}
