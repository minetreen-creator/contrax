/**
 * WEEKLY BID DIGEST — the free Basic plan's email (owner 2026-10-01: "Basic
 * should include one email a week").
 *
 * Starter and up get the daily 6 AM digest (src/lib/digest-recipients.ts).
 * Everyone else with an account — Basic users and expired trials — gets ONE
 * email a week, Monday at 6 AM Eastern, listing the bids added in the past
 * week (soonest deadline first, at most DIGEST_MAX_BIDS) with a line saying
 * Starter sends them every morning. Each weekly email is addressed to one
 * person and carries a one-click unsubscribe link.
 *
 * Internal demo/seed tiers never get it (same rule as the daily digest).
 *
 * PURE (no DB, no server imports); unit-tested in weekly-digest.test.ts.
 */
import { DIGEST_TIER_ORDER, isDigestEligible, type DigestUserRow } from "./digest-recipients";
import { HEAD_START_HOURS } from "./head-start";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The weekly email goes out on this New York weekday. */
export const WEEKLY_DIGEST_WEEKDAY = "Monday";
/** A second weekly send is refused within this many days of the last one. */
export const WEEKLY_DIGEST_MIN_GAP_DAYS = 6;
/** Longest window one weekly email covers (a missed Monday is not doubled up). */
export const WEEKLY_DIGEST_MAX_LOOKBACK_DAYS = 8;

/** True when this account should get the free weekly email instead of the daily one. */
export function isWeeklyDigestEligible(row: DigestUserRow, now: number = Date.now()): boolean {
  const email = String(row.email ?? "").trim();
  if (!email || !email.includes("@")) return false;
  if (isDigestEligible(row, now)) return false; // already gets the daily email
  const tier = row.plan_tier ?? null;
  return tier === null || tier === "" || tier in DIGEST_TIER_ORDER;
}

/** De-duplicated weekly recipients, minus anyone who unsubscribed (lower-cased set). */
export function weeklyDigestRecipients(
  rows: readonly DigestUserRow[],
  unsubscribed: ReadonlySet<string>,
  now: number = Date.now(),
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (!isWeeklyDigestEligible(row, now)) continue;
    const email = row.email.trim();
    const key = email.toLowerCase();
    if (seen.has(key) || unsubscribed.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** The weekday name in New York for an instant ("Monday"). */
export function newYorkWeekday(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/New_York" }).format(new Date(now));
}

/**
 * Whether the weekly email should go out now: never within
 * WEEKLY_DIGEST_MIN_GAP_DAYS of the last send (so a manual re-run cannot
 * double-mail anyone), otherwise on Mondays in New York, or when forced.
 */
export function shouldSendWeeklyDigest(
  lastSentAt: string | Date | null | undefined,
  now: number = Date.now(),
  force = false,
): boolean {
  const last = lastSentAt ? new Date(lastSentAt).getTime() : NaN;
  if (!Number.isNaN(last) && now - last < WEEKLY_DIGEST_MIN_GAP_DAYS * DAY_MS) return false;
  return force || newYorkWeekday(now) === WEEKLY_DIGEST_WEEKDAY;
}

/** Start of the week the email covers: since the last weekly send, 7 days by default, never more than 8. */
export function weeklyWindowStart(lastSentAt: string | Date | null | undefined, now: number = Date.now()): Date {
  const floor = now - WEEKLY_DIGEST_MAX_LOOKBACK_DAYS * DAY_MS;
  const last = lastSentAt ? new Date(lastSentAt).getTime() : NaN;
  if (Number.isNaN(last)) return new Date(now - 7 * DAY_MS);
  return new Date(Math.max(last, floor));
}

/**
 * The window the free weekly email lists, shifted back by the paid head start
 * (head-start.ts) so it never includes a bid still inside its head start (HEAD_START_HOURS):
 * [weeklyWindowStart − head start, now − head start]. Consecutive Mondays tile without gaps
 * or repeats, because each window starts where the previous one ended.
 */
export function weeklyWindowBounds(
  lastSentAt: string | Date | null | undefined,
  now: number = Date.now(),
): { start: Date; end: Date } {
  const shift = HEAD_START_HOURS * 60 * 60 * 1000;
  return { start: new Date(weeklyWindowStart(lastSentAt, now).getTime() - shift), end: new Date(now - shift) };
}

export function weeklyUnsubscribeUrl(token: string): string {
  return `https://www.contrax.company/api/email/weekly-unsubscribe?token=${encodeURIComponent(token)}`;
}
