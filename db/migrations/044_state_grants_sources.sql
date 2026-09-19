-- Migration 044 — State Grants R1: the owner's 2026-09-19 P1 corrections
-- (multi-source-safe identity, the corrected status taxonomy, no falsely-open
-- stale records, normalized fields).
--
-- ADDITIVE + IDEMPOTENT + SPLITTABLE: every statement below is safe to re-run
-- any number of times, and no statement contains a `;` (see
-- db/migrations/sql-statements.ts for why — the runner and the test provisioning
-- both execute this file statement by statement). Replayed by
-- db/migrations/run-044.ts (`bun run db/migrations/run-044.ts`).
--
-- WHY (owner review of P1, 2026-09-19 — all four data corrections):
--
-- 1. MULTI-SOURCE-SAFE IDENTITY. `state_grant_sources` is the registry of the
--    official sources we read, and a row's identity becomes (source_id,
--    external_id). The old UNIQUE (state_code, external_id) could NOT be right:
--    two different agencies in one state routinely use the same short program
--    id, and under the old key the second source's record would OVERWRITE the
--    first. state_code stays on the row (denormalised, for queries) but is no
--    longer part of the identity.
-- 2. STATUS TAXONOMY (owner's ordered model): open | upcoming | rolling |
--    closed | unverified. The old CHECK allowed open|forecast|closed; `forecast`
--    is gone, because the owner's rule is that a record whose dates are missing
--    or ambiguous is `unverified` — never auto-classified as a forecast of a
--    future cycle. estimated_close_date stays, and is ONLY ever written when the
--    source itself published an ESTIMATE; a row whose only date is an estimate is
--    `unverified`, so an estimate can never masquerade as a deadline.
-- 3. NO FALSELY-OPEN STALE RECORDS. `last_seen_at` records, per row, the last
--    successful COMPLETE sync that saw it (unchanged rows included). After such a
--    sync, a row the source no longer publishes flips to `unverified` instead of
--    sitting there as a live-looking opportunity forever.
-- 4. NORMALIZED FIELDS. eligible applicants / geography / categories / award
--    range / total funding / matching requirement become real columns (the raw
--    JSONB payload stays as the backstop), so part 2 can filter on them.
--
-- 043's three tables are 0-row in production, so the column adds / NOT NULL /
-- constraint swaps below are clean. A NON-empty table with rows whose source
-- cannot be resolved would fail at `SET NOT NULL` — loudly, on purpose: we do not
-- invent a source for a row we cannot attribute.
--
-- MIRRORED in src/db/schema.sql (the canonical merged schema, applied by
-- `bun run src/db/setup.ts`) and replayed by db/migrations/run-044.ts.
-- The federal /grants product is untouched by every statement here.
CREATE TABLE IF NOT EXISTS state_grant_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The connector's stable id (e.g. 'va-vtc-grants'). Code owns this value;
    -- the table mirrors it, and the sync runner resolves a connector to this row.
    source_key TEXT NOT NULL UNIQUE,
    -- Two-letter USPS state code (may occur many times: one row per SOURCE).
    state_code TEXT NOT NULL,
    -- Human label for the listing this source is.
    name TEXT NOT NULL,
    -- The publishing body, in the source's own words where it names itself.
    agency TEXT NOT NULL,
    -- The ONE official listing this source reads (hard-coded in its connector).
    official_url TEXT NOT NULL,
    -- Host that must be on the approved-host allowlist before a state may be
    -- reported above `unavailable` (fail-closed; see registry.ts).
    official_host TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_state_grant_sources_state ON state_grant_sources (state_code);
-- Seed: the only validated source today (Virginia, the reference connector).
-- Idempotent: re-running rewrites nothing unless one of the values changed.
INSERT INTO state_grant_sources
    (source_key, state_code, name, agency, official_url, official_host)
VALUES
    ('va-vtc-grants', 'VA', 'Virginia Tourism Corporation — Grants and Funding',
     'Virginia Tourism Corporation', 'https://www.vatc.org/grants/', 'www.vatc.org')
ON CONFLICT (source_key) DO UPDATE SET
    state_code = EXCLUDED.state_code,
    name = EXCLUDED.name,
    agency = EXCLUDED.agency,
    official_url = EXCLUDED.official_url,
    official_host = EXCLUDED.official_host,
    updated_at = NOW()
WHERE state_grant_sources.state_code IS DISTINCT FROM EXCLUDED.state_code
   OR state_grant_sources.name IS DISTINCT FROM EXCLUDED.name
   OR state_grant_sources.agency IS DISTINCT FROM EXCLUDED.agency
   OR state_grant_sources.official_url IS DISTINCT FROM EXCLUDED.official_url
   OR state_grant_sources.official_host IS DISTINCT FROM EXCLUDED.official_host;
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES state_grant_sources (id);
-- Backfill any pre-existing Virginia row to the VA source (0 rows today), then
-- require attribution: an opportunity always belongs to exactly one source.
UPDATE state_grant_opportunities
   SET source_id = (SELECT id FROM state_grant_sources WHERE source_key = 'va-vtc-grants')
 WHERE source_id IS NULL
   AND state_code = 'VA';
ALTER TABLE state_grant_opportunities ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS eligible_applicants TEXT NOT NULL DEFAULT 'Not specified';
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS eligible_geography TEXT NOT NULL DEFAULT 'Not specified';
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS award_range TEXT NOT NULL DEFAULT 'Not specified';
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS award_min_amount NUMERIC;
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS award_max_amount NUMERIC;
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS total_funding TEXT NOT NULL DEFAULT 'Not specified';
ALTER TABLE state_grant_opportunities ADD COLUMN IF NOT EXISTS matching_requirement TEXT NOT NULL DEFAULT 'Not specified';
-- Old `forecast` rows have no honest home in the new taxonomy: the owner's rule
-- is that a record with no confirmable dates is `unverified`. The CHECK swap is
-- three statements because the constraint must be DROPPED before the rows can be
-- remapped (and re-adding it is what re-validates the whole table). Order matters.
ALTER TABLE state_grant_opportunities DROP CONSTRAINT IF EXISTS state_grant_opportunities_status_check;
UPDATE state_grant_opportunities SET status = 'unverified' WHERE status = 'forecast';
ALTER TABLE state_grant_opportunities ADD CONSTRAINT state_grant_opportunities_status_check
    CHECK (status IN ('open', 'upcoming', 'rolling', 'closed', 'unverified'));
-- IDENTITY: (source_id, external_id) — the same external id from two agencies in
-- one state is TWO rows, never an overwrite. The old state_code-keyed UNIQUE
-- constraint is dropped, and the new key is a UNIQUE INDEX (not a constraint) so
-- this file stays re-runnable without a PL/pgSQL block.
ALTER TABLE state_grant_opportunities DROP CONSTRAINT IF EXISTS state_grant_opportunities_state_external_key;
CREATE UNIQUE INDEX IF NOT EXISTS state_grant_opportunities_source_external_key
    ON state_grant_opportunities (source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_source_status
    ON state_grant_opportunities (source_id, status);
-- The registry mirror's ladder gains the validated tiers (limited / curated /
-- connected). VA was the only `connected` row under the old model and is
-- `limited` under the corrected one (one tourism source, two open programs — not
-- statewide coverage); any other row is left alone, and the next registry mirror
-- sync rewrites the table from the derived registry anyway (it is a mirror, never
-- a source of truth). Same drop-remap-re-add order as the status swap above.
ALTER TABLE state_grant_registry DROP CONSTRAINT IF EXISTS state_grant_registry_status_check;
UPDATE state_grant_registry SET status = 'limited' WHERE state_code = 'VA' AND status = 'connected';
ALTER TABLE state_grant_registry ADD CONSTRAINT state_grant_registry_status_check
    CHECK (status IN ('unavailable', 'limited', 'curated', 'connected'));
