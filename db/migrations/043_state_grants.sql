-- Migration 043 — State Grants rollout, part 1: data infrastructure
-- (owner ROLLOUT order 2026-09-18 — "Common schema (state grant opportunities +
-- sync runs + state registry tables)").
--
-- Contrax Grants today is FEDERAL-ONLY and stateless: /api/grants/search hits the
-- official Grants.gov web service live and NOTHING is ever stored. The state
-- rollout adds a STORED corpus for state-level opportunities, because unlike
-- Grants.gov there is no single national state-grants API — each state's source
-- is scraped on a schedule and the parsed records must survive between runs.
-- These three tables are that store. They are ISOLATED from the federal product
-- and from everything else: no federal route, page, event, price or table is
-- touched, and nothing here is read by /grants.
--
-- THREE TABLES
--   state_grant_opportunities — one row per source opportunity, keyed by
--       (state_code, external_id). The source's own id is the identity, so a
--       re-published (amended) record updates the SAME row, never a new one.
--       `fingerprint` is a CONTENT hash used only for change detection, so a
--       re-run that sees identical content writes nothing at all (no no-op
--       rewrites — the Neon CU discipline used elsewhere in this repo).
--   state_grant_sync_runs — one row per sync attempt: status ok or error, the
--       fetched/inserted/updated counts, and the error payload for a failure.
--       A failed run is recorded here with ZERO opportunity writes (fail-closed).
--   state_grant_registry — one row per state (50 states + DC). `status` is
--       DERIVED from the code-level registry (src/lib/state-grants/registry.ts),
--       which reports `connected` ONLY for a state that has both a connector and
--       a passing source-validation test. It is written by the registry sync, and
--       a state without a validated source is never `connected`.
--
-- HONESTY CONTRACT (carried over verbatim from federal grants, #399):
--   open     = a published closing date that has not passed (ET day boundary,
--              inclusive) or an explicit source-declared ongoing program, and a
--              record whose deadline cannot be confirmed is NEVER open.
--   forecast = the source announces a cycle that is not open yet, or published no
--              usable deadline at all. Its announced date lives in
--              `estimated_close_date` and must never be rendered as a deadline.
--   closed   = the published closing date has passed.
--   `close_date` is therefore ONLY ever set for open/closed rows, and a forecast
--   row keeps `close_date` NULL so an estimate can never masquerade as a deadline.
--
-- ADDITIVE + IDEMPOTENT: creates three new tables + indexes, touches no existing
-- table or row, and is safe to re-run any number of times. Every statement is
-- also mirrored in src/db/schema.sql (the canonical merged schema, applied by
-- `bun run src/db/setup.ts`) and replayed by db/migrations/run-043.ts (the
-- idempotent runner, `bun run db/migrations/run-043.ts`).
--
-- NOT applied to production in this PR — owner approval required, see
-- shared/state-grants-p1-2026-09-18.md for the exact command.

CREATE TABLE IF NOT EXISTS state_grant_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Two-letter USPS state code, incl. 'DC'. The state registry (not this
    -- column) is the authority on which states we actually cover.
    state_code TEXT NOT NULL,
    -- The SOURCE's own identifier for this opportunity (for Virginia: the slug
    -- of the official VTC program page). Never invented, never positional.
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    agency TEXT,
    summary TEXT,
    -- Derived by src/lib/state-grants/connector.ts classifyStateGrant() — see
    -- the honesty contract above. Anything unconfirmed is forecast, never open.
    status TEXT NOT NULL CHECK (status IN ('open', 'forecast', 'closed')),
    -- Source-published dates, 'YYYY-MM-DD'. NULL when the source published none.
    posted_date DATE,
    close_date DATE,
    -- FORECAST ONLY: the date the source announced for a cycle that has not
    -- opened yet. Must never be shown as a closing deadline.
    estimated_close_date DATE,
    -- The opportunity's own page on the official source (falls back to the
    -- listing page when the source gives no per-record link).
    url TEXT NOT NULL,
    -- The official listing page this row was parsed from.
    source_url TEXT NOT NULL,
    -- Content hash (not a security primitive). Same content means the same
    -- value, so a re-run leaves the row untouched, while changed content is a
    -- detected amendment.
    fingerprint TEXT NOT NULL,
    -- The source's own "last updated" stamp, when it publishes a per-record one.
    -- NULL when it does not (Virginia publishes none — see CONVENTIONS.md).
    source_updated_at TIMESTAMPTZ,
    -- The parsed source fields verbatim, so nothing has to be re-fetched to
    -- re-derive a decision. Raw source payload only — no invented keys.
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Identity: the source's id within its state. This is what makes re-runs
    -- idempotent and makes an amendment update rather than duplicate.
    CONSTRAINT state_grant_opportunities_state_external_key
        UNIQUE (state_code, external_id)
);

CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_status
    ON state_grant_opportunities (state_code, status);
CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_close_date
    ON state_grant_opportunities (state_code, close_date);

CREATE TABLE IF NOT EXISTS state_grant_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    -- ok only when the whole run committed. Every failure path records an error
    -- row with zero opportunity writes from that run.
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    fetched_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    -- { stage, message, ... } for a failed run, NULL when ok.
    error JSONB
);

CREATE INDEX IF NOT EXISTS idx_state_grant_sync_runs_state_started
    ON state_grant_sync_runs (state_code, started_at DESC);

CREATE TABLE IF NOT EXISTS state_grant_registry (
    state_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- DERIVED, never hand-set: connected requires a connector AND a passing
    -- source-validation test (src/lib/state-grants/registry.ts).
    status TEXT NOT NULL CHECK (status IN ('unavailable', 'connected')),
    connector_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
