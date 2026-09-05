-- Migration 029 — bid_losses full modern schema (ratifies the losses.tsx
-- self-heal list; additive/nullable only).
--
-- The /losses "Why You Lost" route self-heals its table via ensureTable():
-- the CREATE TABLE IF NOT EXISTS carries the FULL modern column list so a
-- brand-new environment gets the complete shape in one shot, and an ALTER
-- loop adds any still-missing columns to older shapes. Prod's bid_losses was
-- created in an ANCIENT shape (missing debrief_notes, weaknesses, etc.), and
-- QA already applied the additive ALTERs manually via real executors (no data
-- touched, disclosed). This migration ratifies exactly that: same additive,
-- nullable-only columns, idempotent, safe to re-run anywhere.
--
-- No data backfill and no destructive changes: every statement is
-- CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS bid_losses (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  bid_title TEXT NOT NULL,
  agency TEXT NOT NULL,
  estimated_value TEXT,
  awarded_to TEXT,
  debrief_notes TEXT,
  naics_code TEXT,
  weaknesses JSONB DEFAULT '[]'::jsonb,
  primary_reason TEXT,
  severity TEXT,
  actionable_fix TEXT,
  recurring_count INTEGER DEFAULT 0,
  autopsy JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS estimated_value TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS awarded_to TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS debrief_notes TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS naics_code TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS weaknesses JSONB DEFAULT '[]'::jsonb;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS primary_reason TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS actionable_fix TEXT;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS recurring_count INTEGER DEFAULT 0;
ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS autopsy JSONB;