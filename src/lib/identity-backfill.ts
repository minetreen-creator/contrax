import type { NeonQueryFunction } from "@neondatabase/serverless";
/**
 * Shared anonymous→account identity backfill (Visitor Journeys, step 2).
 *
 * When a user signs up / logs in / authenticates via OAuth, we tie their
 * ENTIRE pre-auth anonymous journey to the account so the admin Visitor
 * Journeys board can recognize them by email instead of "Anonymous <id>". Two
 * tables carry the journey:
 *
 *   - funnel_events  (custom conversion events, e.g. radar_scan_complete,
 *                     signup_view, signup_success, save_success, rfp_brief_result)
 *   - page_views     (every page load)
 *
 * Both already carry nullable `visitor_id` / `user_id` / `user_email` columns
 * (idempotent lazy ALTER guards below add them on legacy tables). This helper
 * backfills `user_id` / `user_email` onto every row whose `visitor_id` matches
 * the browser's current `contrax_vid`, scoped exactly to that visitor so we
 * never over-link.
 *
 * FAIL-OPEN + BEST-EFFORT: this must never fail the auth call it sits inside.
 * Callers wrap this in try/catch and log. The DDL guards are idempotent no-ops
 * once the columns/index exist; the UPDATEs are the actual per-signup work.
 */
/**
 * The `sql` handle from ~/db — a `() => NeonQueryFunction` factory (call `sql()`
 * to get the tag function, then tag the query template against it). We work with
 * the factory so callers can pass their own `sql` directly.
 */
export type SqlFactory = () => NeonQueryFunction<false, false>;

/** Backfill both analytics tables for one visitor; returns { funnel, page_views } row counts. */
export async function backfillVisitorIdentity(
  db: SqlFactory,
  userId: number | string,
  userEmail: string,
  visitorId: string,
): Promise<{ funnel: number; page_views: number }> {
  if (!visitorId) return { funnel: 0, page_views: 0 };
  const uid = String(userId);
  const email = String(userEmail);

  // Idempotent schema guards (cheap no-ops on modern tables, additive on legacy).
  await db()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await db()`ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS user_email TEXT`;
  await db()`CREATE INDEX IF NOT EXISTS idx_funnel_events_vid ON funnel_events (visitor_id)`;
  await db()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await db()`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_email TEXT`;
  await db()`CREATE INDEX IF NOT EXISTS idx_page_views_vid ON page_views (visitor_id)`;

  const f = await db()`
    UPDATE funnel_events
    SET user_id = ${uid}, user_email = ${email}
    WHERE visitor_id = ${visitorId}
      AND (user_id IS NULL OR user_id = '')
  `;
  const p = await db()`
    UPDATE page_views
    SET user_id = ${uid}, user_email = ${email}
    WHERE visitor_id = ${visitorId}
      AND (user_id IS NULL OR user_id = '')
  `;

  const funnel = Number((f as unknown as { rowCount?: number }).rowCount ?? 0);
  const page_views = Number((p as unknown as { rowCount?: number }).rowCount ?? 0);
  return { funnel, page_views };
}
