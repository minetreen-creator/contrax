-- Migration 020 — radar_saves in-app fulfillment tracking.
--
-- Owner direction (2026-08-30): radar-save alerts are NO LONGER emailed.
-- Instead, when a user creates/logs into an account whose email matches a
-- `radar_saves` row, we surface their saved criteria + CURRENT matching bids
-- in-app on the dashboard. This migration adds the columns we use to track
-- when a saved row has been fulfilled in-app, so the banner does not reappear
-- on every login after the user has acted on it.
--
-- `fulfilled_at` / `fulfilled_user_id` are set (once) when a logged-in user
-- whose email matches the row successfully saves the recomputed matches to
-- their pipeline (or otherwise acts). Rows with these columns set are hidden.
--
-- Existing `unsubscribed` / `unsubscribed_at` columns stay in place (no
-- destructive migration) but are inert: no code references them anymore and
-- no radar-save email can ever be sent.

ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_user_id BIGINT;
CREATE INDEX IF NOT EXISTS radar_saves_fulfilled_at_idx ON radar_saves (email) WHERE fulfilled_at IS NULL;
