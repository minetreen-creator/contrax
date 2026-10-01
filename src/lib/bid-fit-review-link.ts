/**
 * "Get a $99 Bid Fit Review of this bid" — the link shown next to an open bid.
 *
 * It points to /bid-fit-review with the bid's official notice link and its
 * deadline date pre-filled, so the visitor only adds their own details.
 *
 * The review is delivered within two business days and always before the
 * deadline (see /bid-fit-review), so the link is only offered when the bid has
 * an official link and its deadline is at least MIN_DAYS_BEFORE_DEADLINE away.
 * Pure and client-safe.
 */

export const MIN_DAYS_BEFORE_DEADLINE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** "October 12, 2026" — the date only; the visitor adds the time and zone. */
export function deadlineDateText(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function bidFitReviewHref(
  bid: { source_url: string | null | undefined; due_date: string | null | undefined },
  now: number = Date.now(),
): string | null {
  if (!isHttpUrl(bid.source_url) || !bid.due_date) return null;
  const due = Date.parse(bid.due_date);
  if (Number.isNaN(due) || due - now < MIN_DAYS_BEFORE_DEADLINE * DAY_MS) return null;
  const params = new URLSearchParams({ url: bid.source_url, deadline: deadlineDateText(bid.due_date) });
  return `/bid-fit-review?${params.toString()}`;
}
