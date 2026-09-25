-- Migration 050 — SUBCONTRACTING PREVIEW, part 1: the DATA LAYER
-- (owner directive 2026-09-25, BUILD-PLAN.md §6.2).
--
-- ADDITIVE + IDEMPOTENT + SPLITTABLE: every statement below is safe to re-run any
-- number of times, and NO statement contains a `;` (see db/migrations/sql-statements.ts
-- for why — the runner and the real-DB test provisioning both execute this file
-- statement by statement). The file touches no existing table, column, index or row:
-- a fresh CREATE TABLE IF NOT EXISTS that already exists is a no-op, so applying it to
-- a database that already has these tables RE-WRITES NOTHING.
-- Applied by db/migrations/run-050.ts (`bun run db/migrations/run-050.ts`), which is
-- hand-run only — it is never reachable from a test, CI job or schedule.
--
-- WHY. SBA SUBNet is the only public source of OPEN prime-posted subcontracting
-- opportunities (verified 2026-09-25: no API, no JSON, no RSS, no export; a
-- server-rendered Drupal index of 10 rows/page + one /opportunity/<slug> detail page
-- per notice). The preview's draft (PR #448) shipped 7 hand-written notices in TS;
-- this migration is the storage those rows are replaced with.
--
-- IDENTITY is (source_id, external_id) — the SUBNet detail-page slug — exactly the
-- state-grants rule (owner correction 1, 2026-09-19). `natural_key`
-- (md5 over the source URL + prime + title + closing date) is stored for AUDIT and to
-- detect a slug change, and is deliberately NOT the identity: SBA amends notices IN
-- PLACE (same slug, new dates) and the same title legitimately exists twice
-- (`...-landscaping` and `...-landscaping-0`), so a natural-key-only identity would
-- silently merge two real notices into one.
--
-- EXPIRY (BUILD-PLAN §6.2). `closing_date >= (now AT TIME ZONE 'America/New_York')::date`
-- is the ONLY thing that can make a notice `open` — the closing day itself is INCLUSIVE.
-- Before that day it is `closed` and hidden. NO closing date at all (measured 91 of 141
-- SUBNet notices on 2026-09-25) is `unverified` and hidden from the default open set —
-- a missing date is never rendered as an open deadline and never expired by inference.
--
-- NO SOURCE TIMESTAMP EXISTS. SUBNet publishes no posted/updated date (no dateModified,
-- no article:* meta, and its Last-Modified header equals the response time), so
-- `source_updated_at` stays NULL ALWAYS — never invented. "Last verified" is OUR last
-- successful fetch of the row: `last_seen_at` (set for every row a COMPLETE run saw) and
-- `last_verified_at` (same event, kept under the brief's name).
--
-- NAME MAP (brief wording → column here — the concepts are identical, the column names
-- follow BUILD-PLAN §6.2): `prime` → prime (plan: prime_name), `state` → state_code,
-- `contact` → contact_name/contact_email/contact_phone (plan: poc_*), `due_date` /
-- closing date → closing_date, `unverified` bucket flag → status = 'unverified',
-- `last_verified_at` → last_verified_at + last_seen_at, `naics` → naics (the source's own
-- `code: title` string) + naics_code/naics_title (normalized), `fy` → subcontract_primes.fy,
-- `value` → subcontract_primes.value, `pop_state` → subcontract_primes.pop_states[]
-- (an award row has one principal place of performance, a COMPANY has many).
--
-- PART 3 (the annual FY24 directory XLSX) IS NOT INGESTED HERE: its files live under
-- `/sites/default/files/*`, which legacy.sba.gov's robots.txt DISALLOWS, so the corpus is
-- operator-loaded (BUILD-PLAN §6.1 S2 / decision 3). `subcontract_primes` therefore ships
-- EMPTY by design; the notices table is the live, crawled half.
--
-- MIRRORED in src/db/schema.sql (the canonical merged schema the bootstrap tests build
-- from) — a missing mirror entry is a latent CI failure.

CREATE TABLE IF NOT EXISTS subcontract_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    agency TEXT NOT NULL,
    official_url TEXT NOT NULL,
    official_host TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('subnet', 'prime_directory')),
    cadence TEXT NOT NULL,
    coverage_tier TEXT NOT NULL CHECK (coverage_tier IN ('unavailable', 'limited', 'curated', 'connected')),
    note TEXT,
    approved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS subcontract_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES subcontract_sources (id),
    external_id TEXT NOT NULL,
    natural_key TEXT NOT NULL,
    title TEXT NOT NULL,
    prime TEXT NOT NULL,
    prime_uei TEXT,
    prime_division TEXT,
    website TEXT,
    scope TEXT,
    summary TEXT,
    trades TEXT[] NOT NULL DEFAULT '{}',
    certs_solicited TEXT[] NOT NULL DEFAULT '{}',
    naics TEXT,
    naics_code TEXT,
    naics_title TEXT,
    place_of_performance TEXT,
    state_code TEXT,
    closing_date DATE,
    performance_start_date DATE,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    source_url TEXT NOT NULL,
    detail_url TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'unverified')),
    status_reason TEXT,
    source_updated_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fingerprint TEXT NOT NULL,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_subcontract_opportunities_open
    ON subcontract_opportunities (status, closing_date, state_code);
CREATE INDEX IF NOT EXISTS idx_subcontract_opportunities_source_status
    ON subcontract_opportunities (source_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_subcontract_opportunities_natural_key
    ON subcontract_opportunities (natural_key);
CREATE INDEX IF NOT EXISTS idx_subcontract_opportunities_trades
    ON subcontract_opportunities USING GIN (trades);
CREATE TABLE IF NOT EXISTS subcontract_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    stage TEXT,
    counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    message TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subcontract_sync_runs_source_started
    ON subcontract_sync_runs (source_key, started_at DESC);
CREATE TABLE IF NOT EXISTS subcontract_primes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES subcontract_sources (id),
    uei TEXT NOT NULL,
    legal_name TEXT NOT NULL,
    ultimate_parent_name TEXT,
    ultimate_parent_uei TEXT,
    naics TEXT[] NOT NULL DEFAULT '{}',
    industries TEXT[] NOT NULL DEFAULT '{}',
    vendor_state TEXT,
    pop_states TEXT[] NOT NULL DEFAULT '{}',
    agencies TEXT[] NOT NULL DEFAULT '{}',
    award_rows INTEGER NOT NULL DEFAULT 0,
    value NUMERIC,
    latest_pop_start DATE,
    subcontract_plan_type TEXT,
    fy TEXT NOT NULL,
    source_url TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, uei)
);
CREATE INDEX IF NOT EXISTS idx_subcontract_primes_state
    ON subcontract_primes (vendor_state, fy);
