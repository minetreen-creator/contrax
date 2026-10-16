-- Migration 063 — hauling_leads (trucking queue item #4, owner-endorsed 2026-10-16).
--
-- WHAT IT IS. One row per federal contract award whose published record passed the
-- owner-endorsed definition "R" of "may need hauling"
-- (shared/trucking-4-hauling-leads-proposal-2026-10-16, sections 4-5): the keyword arm
-- plus >= $25,000, a newly made award (base obligation date inside the window), an
-- award NAICS that is NOT freight/courier/postal, DESCRIPTION matching the
-- hauling-scope regex, a winner name that does not read as a hauling/waste firm, and
-- an award NAICS inside the service family that plausibly subcontracts hauling.
-- It is read by ONE section on /subcontracts (GET /api/hauling-leads). No other
-- surface reads it: no Radar, no email, no new tier and no paywall.
--
-- ADDITIVE ONLY: one new table, two indexes. No existing table is touched and no data
-- row is written by this migration (run-063.ts proves both before/after).
--
-- IDEMPOTENT BY CONSTRUCTION: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- ROLLBACK (a whole-table drop, which the owner must authorise; the surface degrades to
-- its honest empty state on its own):
--   DROP INDEX IF EXISTS hauling_leads_pop_state_idx;
--   DROP INDEX IF EXISTS hauling_leads_award_date_idx;
--   DROP TABLE IF EXISTS hauling_leads;
CREATE TABLE IF NOT EXISTS hauling_leads (
  id SERIAL PRIMARY KEY,
  award_key TEXT NOT NULL UNIQUE,
  award_id TEXT NOT NULL,
  award_date DATE,
  pop_state TEXT,
  pop_city TEXT,
  prime_name TEXT NOT NULL,
  prime_uei TEXT,
  amount BIGINT NOT NULL,
  naics_code TEXT,
  naics_description TEXT,
  agency TEXT,
  usa_spending_url TEXT NOT NULL,
  description_snippet TEXT NOT NULL,
  hauling_scope BOOLEAN NOT NULL DEFAULT TRUE,
  scope_kind TEXT NOT NULL,
  prime_kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hauling_leads_award_date_idx ON hauling_leads (award_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS hauling_leads_pop_state_idx ON hauling_leads (pop_state);
