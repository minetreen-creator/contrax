-- Migration 014: admin-query + rate-limiter indexes.
--
-- Forward-looking indexes for the admin dashboard filter queries
-- (src/routes/api/admin/metrics.ts, user-activity.ts) and the DB-backed rate
-- limiter (src/lib/rate-limit.ts) as the users / funnel_events / rate_limits /
-- waitlist tables scale. All plain CREATE INDEX IF NOT EXISTS — at this app's
-- table sizes non-blocking and idempotent; no CONCURRENTLY needed.
--
-- What was EXPLAIN-verified (live DB, 2026-08-29):
--   * rate_limits prune DELETE (window_start < now-3d, ~1/64 of guarded POSTs)
--     plans as a Seq Scan — table-scan on every prune → index converts it to an
--     index-range delete. PK (scope,key,window_start) canNOT serve this because
--     its leading columns are scope+key, and the prune filters only on
--     window_start.
--   * rate_limits UPSERT already uses PK (scope,key,window_start) as its
--     conflict arbiter ("Conflict Arbiter Indexes: rate_limits_pkey") — NO
--     extra upsert index.
--   * users recentUsers/recentSignups + user-activity ORDER BY created_at DESC
--     had no index (seq scan) — idx_users_created_at serves the "recent N"
--     pattern and is backwards-scannable.
--   * waitlist recentWaitlist ORDER BY created_at DESC LIMIT 10 (low priority;
--     table currently empty).
--   * funnel_events recent DESC LIMIT 20 / today / last7 / byName already use
--     idx_funnel_events_created_at (Index Scan Backward / Index Scan / Index
--     Only Scan). The last7/byName seq scans are an artifact of 62% of the tiny
--     table falling inside the 7-day window; the existing created_at index
--     takes over as the window fraction shrinks — NO new funnel index.
--
-- Mirrored in db/setup.ts (Migration 014 block).

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits (window_start);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at);
