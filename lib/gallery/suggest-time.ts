import type { DayPart, Weekday } from "@/lib/analysis/posts";

/**
 * The suggested time on a real post card / draft: the next time at the business's best posting slot
 * (weekday and part of day from its own posts, lib/analysis/growth-signals.ts), else tomorrow evening.
 * Only a suggestion: nothing is scheduled from it yet. Pure so the tests import it.
 */

/** The hour each part of the day suggests (local time). */
const PART_HOUR: Record<DayPart, [number, number]> = { morning: [10, 0], afternoon: [14, 0], evening: [19, 0], night: [22, 30] };
const DEFAULT_SLOT: [number, number] = [19, 0];
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** At least this long from now. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;

/** Local calendar parts of an instant in a time zone (UTC when the zone is unknown). */
function localParts(at: Date, timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  }
  const get = (type: string) => Number(format.formatToParts(at).find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** The instant of a local wall-clock time in `timeZone`. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const local = localParts(new Date(guess), timeZone);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - guess;
  return new Date(guess - offset);
}

export function suggestPostTime(now: Date, timeZone: string, slot: { weekday: Weekday | null; dayPart: DayPart | null } | null): Date {
  const [hour, minute] = slot?.dayPart ? PART_HOUR[slot.dayPart] : DEFAULT_SLOT;
  const today = localParts(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    // Calendar arithmetic on a UTC date, then placed in the zone.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (slot?.weekday && date.getUTCDay() !== WEEKDAY_INDEX[slot.weekday]) continue;
    const at = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
    if (at.getTime() - now.getTime() >= MIN_LEAD_MS) return at;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
