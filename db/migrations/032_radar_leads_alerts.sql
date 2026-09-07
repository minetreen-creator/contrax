-- Migration 032 — Radar match-alert dedupe columns + sent-log (owner 2026-09-06;
-- follow-up to migration 031's radar_leads capture + the confirmation email).
--
-- The periodic match-alert sender (src/lib/radar-lead-alerts.ts) emails ONLY
-- confirmed, not-unsubscribed, consenting leads about NEW open bids matching
-- their Radar profile. Two dedupe layers keep the same bid from ever being
-- emailed to the same lead twice:
--
--   1. sent_bid_ids — a per-lead JSONB array of already-emaild bid ids. The
--      sender's candidate query excludes any bid already in it
--      (NOT (sent_bid_ids ? CAST(id AS text))) and advances it after each
--      successful send. Capped at 512 ids (oldest half rotated out when past)
--      so an extremely active lead's list stays bounded.
--
--   2. radar_alerts_sent — a crash-safe sent-log (lead_id × bid_id, PK). If an
--      email sends but the process dies before sent_bid_ids is flushed, the
--      next run still won't re-notify about a bid already in this log — the
--      same belt-and-suspenders guarantee as the legacy radar_saves alerts
--      (migration 019).
--
--   last_alerted_at — per-lead low-water mark (when the last alert email went
--   out); informational + useful for admin reads.
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
-- so it is safe to re-run on any environment (same convention as 019/031); the
-- route/job also self-heals it at runtime.
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS sent_bid_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS radar_alerts_sent (
  lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
  bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lead_id, bid_id)
);
-- PK(lead_id, bid_id) already serves the per-lead "already sent?" lookup; this
-- secondary index lets "which lead ids have sent rows" scans stay narrow.
CREATE INDEX IF NOT EXISTS radar_alerts_sent_lead_idx ON radar_alerts_sent (lead_id);