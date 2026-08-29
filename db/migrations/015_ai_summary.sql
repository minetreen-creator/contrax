-- AI RFP Executive Summary & Requirements Extractor
-- Adds per-bid cached AI summary columns to the `bids` table.
-- Idempotent: safe to run repeatedly on any environment. The runtime path also
-- self-heals with the same ADD COLUMN IF NOT EXISTS (see run-015.ts and
-- src/routes/api/bids.$id.analyze.ts).
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;
