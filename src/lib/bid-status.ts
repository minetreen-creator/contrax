/**
 * Bid lifecycle helpers for separating LIVE (open/closing-soon/relevant)
 * opportunities from DEAD/CLOSED ones (past-due or dismissed/no-go) in the
 * dashboard matched feed.
 *
 * "Live" vs "Dead" is derived from two real fields only — `bids.due_date`
 * (a TIMESTAMPTZ) and `saved_matches.status` — no fabricated lifecycle.
 *
 * - LIVE   = due date is today or in the future (date-granularity, matching the
 *   platform's existing "urgent / closing soon" semantics in dashboard-data,
 *   which treats a bid whose deadline date is today as still open), AND the
 *   user has not dismissed / closed it.
 * - DEAD   = due date is strictly before today, OR the user dismissed / closed
 *   it (regardless of due date).
 *
 * `ARCHIVED_STATUSES` are the `saved_matches.status` values that put a match
 * into the archived bucket. `dismissed` is the one the dashboard's dismiss
 * action writes today; the others are the additional "no-go/hidden/rejected"
 * values the codebase already references (src/lib/learning.ts) plus the
 * `closed`/`no-go` labels the product treats as dead — kept here so a future
 * status transition simply falls into the right bucket without a code change.
 */
export const ARCHIVED_STATUSES = [
  "dismissed",
  "closed",
  "no-go",
  "no_go",
  "rejected",
  "hidden",
] as const;

export const LIVE_SQL = `(due_date IS NULL OR due_date::date >= NOW()::date)`;

export const DEAD_SQL = `(due_date IS NOT NULL AND due_date::date < NOW()::date)`;
