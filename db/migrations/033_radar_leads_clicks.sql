-- Migration 033 — Radar match-alert CTA click logging (owner 2026-09-07;
-- follow-up to migration 032's alert dedupe + sender).
--
-- The periodic match-alert email's per-bid "View opportunity →" CTA points at
-- /api/radar/opportunity-click?bid=<id>&token=<unsubscribe_token> (the PII-safe
-- redirect: raw email never in URLs/logs; only the SHA-256 token hash is
-- stored). Two storage pieces make that measurable without double counts:
--
--   1. radar_leads.click_count / .last_clicked_at — per-lead counters for the
--      masked admin leads table (no per-click PII on the lead row itself).
--      Incremented ONLY when a click actually inserts (repeat clicks on the
--      same bid are absorbed by the log's PK and never re-increment).
--
--   2. radar_lead_opportunity_clicks — the per-click log (lead_id × bid_id,
--      PK). The sender pre-seeds one row per (lead, bid) it ACTUALLY emailed
--      (sent_bid_ids advanced only after a successful send), so a click counts
--      strictly inside the mailed set. The redirect route's idempotent insert
--      refreshes clicked_at on repeat clicks — a second click never creates a
--      second row and never re-increments click_count. token_hash is the
--      SHA-256 of the lead's unsubscribe_token (the value that resolves the
--      lead server-side); the raw token is never stored.
--
--      DISTINCT NAME warning (collision lesson from 019/032): migration 019
--      owns `radar_alerts_sent` (radar_save_id × bid_id, legacy radar_saves
--      alerts) and migration 032 owns `radar_leads_alerts_sent` (lead_id ×
--      bid_id, the alert sent-log). This CLICK log is a THIRD, distinct table
--      (`radar_lead_opportunity_clicks`) — reusing either existing name would
--      silently no-op CREATE TABLE and the lead_id INSERT/index would crash
--      against the wrong schema. The 019/032 tables must never be touched by
--      the radar-lead click path.
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
-- so it is safe to re-run on any environment (same convention as 031/032); the
-- redirect route + sender also self-heal it at runtime.
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0;
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS radar_lead_opportunity_clicks (
  lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
  bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash TEXT,
  PRIMARY KEY (lead_id, bid_id)
);
-- PK(lead_id, bid_id) already serves the per-lead "clicked?" lookup; this
-- secondary index keeps per-lead scans in the admin leads table narrow.
CREATE INDEX IF NOT EXISTS radar_lead_opportunity_clicks_lead_idx ON radar_lead_opportunity_clicks (lead_id);