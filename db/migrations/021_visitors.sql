-- Migration 021 — per-visitor SUMMARY cache for the Visitor Journeys board.
-- Admin Tracker Enrichment (owner 2026-08-31). The `visitors` table is a
-- fast-display SUMMARY cache upserted at intake (single endpoint
-- /api/track-visitor); funnel_events + page_views remain the detailed history
-- (no new timeline/event table).
--
-- Idempotent: every statement uses IF NOT EXISTS, so it is safe to re-run on
-- any environment (same convention as 015–020). The runtime lazy guard lives in
-- src/lib/tracking-intake.ts (ensureVisitorsTable) and is duplicated in
-- src/lib/identity-backfill.ts (linkVisitorConversion) so new deploys never
-- depend on this migration having been run manually.
--
-- PII hygiene: city/region/device/browser labels only on admin surfaces; the
-- stored first_ip/last_ip are raw-edge values for diagnostics only and are
-- NEVER surfaced by the admin board (same as funnel_events/page_views).
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_path TEXT,
  last_path TEXT,
  first_ip TEXT,
  last_ip TEXT,
  city TEXT,
  region TEXT,
  device_type TEXT,
  browser_label TEXT,
  source TEXT,
  radar BOOLEAN NOT NULL DEFAULT FALSE,
  signup TEXT NOT NULL DEFAULT 'Not started',
  activated BOOLEAN NOT NULL DEFAULT FALSE,
  steps INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  last_visit_id TEXT,
  last_action TEXT,
  last_action_at TIMESTAMPTZ,
  converted_user_id TEXT,
  converted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen_at ON visitors (last_seen_at);