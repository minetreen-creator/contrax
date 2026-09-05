-- Migration 027 — Visitor Intelligence "Watch visitor" persistence (owner spec 2026-09-05).
--
-- watched_visitors: the admin's watchlist for anonymous/known visitors on the
-- Visitor Journeys board. One row per watched visitor_id (contrax_vid):
--   * visitor_id     — the persistent per-visitor tracking id (PRIMARY KEY)
--   * added_at       — when the admin started watching
--   * last_viewed_at — the last time an admin EXPANDED this visitor's panel
--                      (GET /api/admin/visitor-intel stamps it); drives the
--                      server-authoritative "returned since last viewed" flag
--   * note           — optional free-text admin note (unused by the UI yet)
--
-- Also adds the per-visitor index on page_views that the intel panel needs —
-- funnel_events already carries idx_funnel_events_visitor_id (written by the
-- tracking-intake guard), but page_views never got one, so every panel open
-- would full-scan page_views.
--
-- Idempotent: safe to run repeatedly on any environment. The runtime path
-- self-heals the table via the same CREATE TABLE IF NOT EXISTS (see
-- src/lib/visitor-intel.ts, ensureWatchedVisitorsTable) — this migration exists
-- so fresh environments get the schema without a manual request first.
CREATE TABLE IF NOT EXISTS watched_visitors (
  visitor_id TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor_id ON page_views (visitor_id);
