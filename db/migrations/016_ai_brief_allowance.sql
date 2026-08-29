-- AI RFP Executive Brief — tiered monthly allowance ledger
-- (owner-ratified 2026-08-29; supersedes the earlier free-tier/ungated ruling)
--
-- Per-user, per-billing-period counter of AI briefs generated. Cached views do
-- NOT increment this counter; a failed (fallback) generation does NOT either.
-- Lower-tier (Basic/Starter) users who exhaust their monthly allowance get the
-- raw description + a locked preview (see src/lib/ai-brief-allowance.ts).
--
-- Allowances (owner pricing matrix):
--   Basic (Free)   =  1 brief / month
--   Starter ($19)  =  3 briefs / month
--   Professional   = 50 briefs / month (full evidence)
--   Agency ($199)  = 200 briefs / month + team sharing + client-ready export
--
-- Idempotent: safe to run repeatedly on any environment. The runtime path also
-- self-heals with the same CREATE TABLE IF NOT EXISTS (see run-016.ts and
-- src/lib/ai-brief-allowance.ts).
CREATE TABLE IF NOT EXISTS ai_brief_allowance (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  billing_period TEXT NOT NULL,          -- YYYY-MM (UTC) of the month
  tier TEXT NOT NULL,                    -- snapshot of the effective tier
  briefs_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, billing_period)
);
