-- Migration 028 — Award Autopsy + Contrax Learning (owner-ratified 2026-09-05).
-- Two minimal pieces, both idempotent:
--
-- 1. autopsy_allowance — per-user monthly Award Autopsy ledger (mirrors
--    ai_brief_allowance). Basic 1/mo · Starter 5/mo · Pro/Agency unlimited.
--    The tier is recorded per-row for analytics; enforcement reads the user's
--    EFFECTIVE tier at consume time (grants/trials/expiry honored — see
--    src/lib/award-autopsy.ts effectiveAutopsyTier).
--
-- 2. bid_losses.autopsy — JSONB snapshot of the outcome (found, winner,
--    winningAmount, difference, differencePct, incumbentRetained, competition,
--    findings, recommendation, historicalPricing). This is the queryable
--    outcome record the Learning Engine's Radar memory matches on
--    (user_email + agency + NAICS prefix + winningAmount > 0). The manual
--    loss columns and the learning_outcomes feed are unchanged.
--
-- No backfill: losses logged before this migration have no autopsy (their
-- learning_outcomes rows still feed the engine as before) and no allowance
-- usage (every user starts the month with a fresh allowance).

CREATE TABLE IF NOT EXISTS autopsy_allowance (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  billing_period TEXT NOT NULL,
  tier TEXT NOT NULL,
  autopsies_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, billing_period)
);

ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS autopsy JSONB;
