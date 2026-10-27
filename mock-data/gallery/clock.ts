// The demo runs on a fixed clock so every date in the mock data reads the same in any meeting.
// Friday 16 October 2026, 7:30 PM Kuwait time (UTC+3).
export const NOW = new Date("2026-10-16T19:30:00+03:00");
export const TIME_ZONE = "Asia/Kuwait";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** ISO time `days` and `hours` before NOW. */
export function ago(days: number, hours = 0, minutes = 0): string {
  return new Date(NOW.getTime() - days * DAY - hours * HOUR - minutes * 60_000).toISOString();
}

/** ISO time for a Kuwait-local date/time `days` from NOW (0 = today). */
export function kuwaitAt(days: number, hour: number, minute = 0): string {
  const base = new Date(NOW.getTime() + days * DAY);
  const y = base.toLocaleString("en-CA", { timeZone: TIME_ZONE, year: "numeric" });
  const m = base.toLocaleString("en-CA", { timeZone: TIME_ZONE, month: "2-digit" });
  const d = base.toLocaleString("en-CA", { timeZone: TIME_ZONE, day: "2-digit" });
  return new Date(`${y}-${m}-${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`).toISOString();
}
