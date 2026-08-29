-- 21-day PROFESSIONAL trial — per-trial usage ledger (owner requirements)
--
-- The 21-day trial is an explicit PROFESSIONAL trial that starts lazily (the
-- clock begins on the user's FIRST premium-feature use, not at signup), needs
-- no credit card, grants Professional-tier access during the trial (NOT
-- Agency), and auto-downgrades to Basic when the 21 days expire WITHOUT
-- deleting saved bids / pipeline / checklist progress.
--
-- This ledger caps the trial's premium usage per TRIAL INSTANCE (keyed to
-- `trial_started_at`, so a new trial instance resets it and it NEVER resets at
-- a calendar-month boundary):
--   5  AI Executive Briefs
--   3  complete bid scores
--   1  proposal draft
--   3  incumbent-intelligence looks
--
-- This is SEPARATE from the MONTHLY `ai_brief_allowance` ledger. A
-- Professional-trial user still has the MONTHLY Professional allowance
-- (50/mo), but the trial's 5-brief cap binds during the trial.
--
-- Idempotent: safe to run repeatedly. The runtime path self-heals with the
-- same CREATE TABLE IF NOT EXISTS (see src/lib/trial-usage.ts and run-017.ts).
CREATE TABLE IF NOT EXISTS trial_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  trial_started_at TIMESTAMPTZ NOT NULL,  -- keys usage to the trial instance
  briefs_used INTEGER NOT NULL DEFAULT 0,
  scores_used INTEGER NOT NULL DEFAULT 0,
  drafts_used INTEGER NOT NULL DEFAULT 0,
  incumbent_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, trial_started_at)
);
