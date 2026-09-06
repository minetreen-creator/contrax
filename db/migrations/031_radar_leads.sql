-- Migration 031 — Radar anonymous email capture (owner's "feature I particularly
-- want", 2026-09-06).
--
-- OPT-IN ONLY. An anonymous visitor who completes a Contract Radar scan can
-- voluntarily leave an email to receive future match alerts — NO account
-- required. This converts the bounce dead-end (e.g. visitor #75be, the
-- "Birmingham anonymous visitor") into an opted-in, consent-recorded lead.
--
-- Semantics of the columns:
--   email               normalized (lowercase, trimmed), UNIQUE — a lead is one row.
--   visitor_id          the persistent contrax_vid from the tracking context
--                       (same id sent with radar_scan_complete), nullable.
--   radar_profile       JSONB snapshot of exactly what the visitor searched
--                       (trade/NAICS, state, cert, sizePreference) — the future
--                       periodic match-alert sender matches new bids against it.
--   source              acquisition source (first-touch attribution), default 'radar'.
--   consent             explicit opt-in, TRUE at capture (the microcopy promises
--                       "We'll email you matching opportunities — unsubscribe
--                       anytime", so consent is explicit at submit time).
--   confirmed_at        set ONCE by the single confirmation link (deliverability
--                       + real-address verification). Null until confirmed.
--   unsubscribed_at     set by the one-click unsubscribe link. Once set, the
--                       capture endpoint never resurrects the address.
--   unsubscribe_token   one-click unsubscribe token (also rides the confirmation
--                       email so one token serves confirm + unsubscribe).
--
-- PII-safe: email is the PII — stored normalized + unique, NEVER logged raw in
-- server logs, masked in admin views (a follow-up admin read can mask it; the
-- capture + email paths keep it out of log lines entirely).
--
-- Forward-compatible by design: this table is the foundation for the queued
-- abandoned-signup recovery email and the periodic match-alert sender.
CREATE TABLE IF NOT EXISTS radar_leads (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  visitor_id TEXT,
  radar_profile JSONB,
  source TEXT NOT NULL DEFAULT 'radar',
  consent BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The periodic sender queries confirmed, not-unsubscribed leads — index it.
CREATE INDEX IF NOT EXISTS idx_radar_leads_confirmed
  ON radar_leads (confirmed_at)
  WHERE confirmed_at IS NOT NULL;