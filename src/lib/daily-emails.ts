/**
 * The morning emails' schedule rule (owner 2026-11-09: "move the email to vercel"). PURE.
 * Each job runs once per New York date, at or after 6 AM New York time.
 */

/** The morning jobs, in the order they run. */
export const DAILY_EMAIL_JOBS = ["bid-digest", "trial-emails", "weekly-digest", "radar-alerts", "max-reminders", "award-check"] as const;
export type DailyEmailJob = (typeof DAILY_EMAIL_JOBS)[number];

/** The send hour, New York time. */
export const DAILY_EMAIL_HOUR = 6;

/** The New York calendar date (YYYY-MM-DD) and hour (0-23) at `now`. */
export function newYorkDayAndHour(now: Date = new Date()): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** True once it is 6 AM or later in New York. */
export function dailyEmailsDue(now: Date = new Date()): boolean {
  return newYorkDayAndHour(now).hour >= DAILY_EMAIL_HOUR;
}
