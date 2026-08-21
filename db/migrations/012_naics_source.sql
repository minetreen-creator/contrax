-- Migration 012: naics_code_source provenance column.
-- Labels how bids.naics_code was set:
--   'authoritative' — supplied by the source (SAM.gov family).
--   'inferred'      — heuristic tagged from title/description (see src/lib/naics-infer.ts,
--                     applied at ingest in src/jobs/runner.ts and by the one-time
--                     backfill src/jobs/backfill-naics.ts).
-- NULL stays when no code is present. This is the honest-enforcement mechanism
-- so any surfaced NAICS can be labeled as inferred.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code_source TEXT;
