-- AI RFP Executive Summary & Requirements Extractor
-- Adds per-bid cached AI summary columns to the `bids` table.
-- Idempotent: safe to run repeatedly on any environment. The runtime path also
-- self-heals with the same ADD COLUMN IF NOT EXISTS (see run-015.ts and
-- src/routes/api/bids.$id.analyze.ts).
--
-- HARDENING (2026-08-28 owner spec): the cache key is the source-content hash
-- (ai_summary_source_hash) + model (ai_summary_model) + schema version
-- (ai_summary_schema_version) — NEVER bid id alone — plus generated-from
-- timestamp for source-freshness warnings, and a general updated_at so the sync
-- path can mark when a solicitation's source data changed.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary JSONB;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_source_hash TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_schema_version INT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_model TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_generated_from_updated_at TIMESTAMPTZ;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
