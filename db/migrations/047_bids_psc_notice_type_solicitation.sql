-- Migration 047 — bids: preserve the PSC, the notice TYPE and SAM's own
-- solicitation number (owner PRIORITY 09-21, R2).
--
-- WHY: the owner's PRESERVE rule requires source / notice type / eligibility /
-- location / deadline on every ingested row. Source, set-aside, location and
-- deadline were already stored; the notice TYPE and the Product Service Code had
-- nowhere to live — the collector read `type.value` only to derive `category` and
-- threw it away, and the PSC was never fetched at all (`information_schema` count
-- of psc columns on bids = 0). And without SAM's own solicitation number there is
-- no key on which to collapse the same federal notice re-ingested under many
-- state-door source labels (R5).
--
-- ADDITIVE + IDEMPOTENT + NO DATA LOSS: three nullable text columns, no default,
-- no backfill, no rewrite of any existing column. A source that cannot supply a
-- value leaves it NULL (never guessed). Existing rows keep working untouched;
-- the read path cannot regress.
--
-- NOT APPLIED BY THIS PR (owner hard rule: no merge/deploy). This file is the
-- reviewed record; db/migrations/run-047.ts is the by-hand runner (never wired
-- into a test or workflow — the sandbox DATABASE_URL IS production).
--
-- Mirrored in src/db/schema.sql (the canonical merged schema).

ALTER TABLE bids ADD COLUMN IF NOT EXISTS psc text;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS notice_type text;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS solicitation_number text;

-- Cross-source dedupe support (R5): the natural-key lookup is
-- (source, solicitation_number) and (lower(title), lower(agency)), both of which
-- are read at query time. A plain btree on solicitation_number is enough — the
-- column is sparse (NULL where the source has none) and non-unique on purpose:
-- the SAME federal notice legitimately appears under more than one source label,
-- and this PR never deletes rows.
CREATE INDEX IF NOT EXISTS idx_bids_solicitation_number
  ON bids (solicitation_number)
  WHERE solicitation_number IS NOT NULL;
