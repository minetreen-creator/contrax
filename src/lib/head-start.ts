/**
 * PAID HEAD START (owner 2026-10-01: "theres gotta be a way to convince people
 * to pay and not stay on the basic plan" → option 1).
 *
 * A bid's first HEAD_START_HOURS on Contrax belong to paying members. During
 * that window anyone without paid access (anonymous visitors, free Basic users,
 * expired trials) still sees that the bid exists — title, buyer, place and
 * deadline — but NOT the link to the original solicitation, which is what lets
 * a business read the documents and start bidding. The link opens for everyone
 * once the window ends. Bids are open for weeks, so free users still get every
 * bid; paying members get them first.
 *
 * The lock is applied on the SERVER (the link is never sent to a free viewer)
 * by `applyHeadStart`; pages render `HeadStartLock` where the link would be.
 *
 * PURE and client-safe: no DB, no server imports. The viewer's paid status is
 * resolved by head-start.server.ts.
 */

/** Owner 2026-10-08: free accounts wait 7 days (was 3) — Basic shrinks, Starter stays the day-one plan. */
export const HEAD_START_DAYS = 7;
export const HEAD_START_HOURS = HEAD_START_DAYS * 24;
const HOUR_MS = 60 * 60 * 1000;

/** When a bid added at `createdAt` leaves the head start (ISO), or null if it already has / is unknown. */
export function headStartUntil(createdAt: string | Date | null | undefined, now: number = Date.now()): string | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return null;
  const until = t + HEAD_START_HOURS * HOUR_MS;
  return until > now ? new Date(until).toISOString() : null;
}

/**
 * Lock one bid for a viewer without paid access: `source_url` becomes null and
 * `head_start_until` says when it opens. Paid viewers (and bids past the
 * window) pass through unchanged, with `head_start_until: null`.
 */
export function applyHeadStart<T extends { source_url?: string | null; created_at?: string | Date | null }>(
  bid: T,
  paid: boolean,
  now: number = Date.now(),
): T & { head_start_until: string | null } {
  const until = paid ? null : headStartUntil(bid.created_at, now);
  if (!until) return { ...bid, head_start_until: null };
  return { ...bid, source_url: null, head_start_until: until };
}

/** "Oct 4" — the day a locked bid opens for free accounts (viewer's local date). */
export function headStartOpensLabel(until: string): string {
  const d = new Date(until);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
