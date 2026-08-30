-- Radar alerts infrastructure — fulfills the "Save your matches" promise
-- (we'll only email you about matching contract opportunities. Unsubscribe
-- anytime). Migration 018 created the opted-in `radar_saves` list; this adds
-- the three pieces the alert job needs to be HONEST and SAFE:
--
--   1. `unsubscribed` / `unsubscribed_at` — a real, one-click unsubscribe.
--      The alert job NEVER emails a row with `unsubscribed = true`. The GET
--      route /api/radar-unsubscribe flips these by email.
--
--   2. `last_alerted_at` — a per-lead LOW-WATER MARK so a re-run never
--      notifies about the same solicitation twice: the job only looks at bids
--      that opened (created_at) AFTER this timestamp. NULL on a fresh opt-in
--      defaults the cutoff to the lead's opt-in time, so people only hear
--      about bids that opened after they subscribed.
--
--   3. `radar_alerts_sent` — a crash-safe sent-log (radar_save_id × bid_id,
--      PK). If an email sends but the process dies before `last_alerted_at`
--      is flushed, the next run STILL won't re-notify about a bid already in
--      this log. This is the belt-and-suspenders guarantee against duplicate
--      notifications across runs/retries.
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
-- so it is safe to re-run on any environment (same convention as 018).
ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS radar_alerts_sent (
  radar_save_id BIGINT NOT NULL REFERENCES radar_saves(id) ON DELETE CASCADE,
  bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (radar_save_id, bid_id)
);
-- PK(radar_save_id, bid_id) already serves the per-lead "already sent?" lookup
-- (NOT EXISTS ... WHERE radar_save_id = $1). This secondary index covers the
-- "which save ids have ANY sent rows" scan if we ever need it.
CREATE INDEX IF NOT EXISTS radar_alerts_sent_save_idx ON radar_alerts_sent (radar_save_id);
-- The alert job scans opted-in, NOT-unsubscribed leads — index the flag so the
-- scan stays a narrow index-only read as the list grows.
CREATE INDEX IF NOT EXISTS radar_saves_unsubscribed_idx ON radar_saves (unsubscribed);
