import type { PostWindow } from "@/types";

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60000) * 60000;
}

/** The instant when the wall clock in `timeZone` shows the given local time. */
export function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Two passes settle DST transitions.
  let result = guess - offsetMs(new Date(guess), timeZone);
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** Posting window a local hour falls in. */
export function windowOfHour(hour: number): PostWindow {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function windowOf(date: Date, timeZone: string): PostWindow {
  return windowOfHour(zonedParts(date, timeZone).hour);
}

/**
 * Next free slot for a new post in `window`: the first day (from today, in
 * `timeZone`) without a post already in that window, at the window's start hour.
 */
export function nextSlot(
  queue: Array<{ scheduledFor: string; window: PostWindow }>,
  window: PostWindow,
  startHour: number,
  timeZone: string,
  now = new Date(),
): string {
  const key = (d: { year: number; month: number; day: number }) => `${d.year}-${d.month}-${d.day}`;
  const taken = new Set(queue.filter((p) => p.window === window).map((p) => key(zonedParts(new Date(p.scheduledFor), timeZone))));
  for (let i = 0; i < 60; i++) {
    const day = zonedParts(new Date(now.getTime() + i * 24 * 60 * 60 * 1000), timeZone);
    const slot = zonedTimeToUtc({ ...day, hour: startHour, minute: 30 }, timeZone);
    if (slot.getTime() > now.getTime() + 15 * 60 * 1000 && !taken.has(key(day))) return slot.toISOString();
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
