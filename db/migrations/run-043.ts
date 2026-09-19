/**
 * Migration 043 — State Grants rollout part 1: data infrastructure (owner
 * ROLLOUT order 2026-09-18). ADDITIVE + IDEMPOTENT: creates three new tables
 * (state_grant_opportunities, state_grant_sync_runs, state_grant_registry) plus
 * their indexes, touches no existing table or row, and is safe to re-run any
 * number of times.
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-043.ts
 *
 * WHY: Contrax Grants is federal-only and stateless today (live Grants.gov
 * search, nothing stored). State opportunities have no national API, so each
 * state's official source is scraped on a schedule and the parsed records must
 * persist between runs. The three tables are that store; they are isolated from
 * the federal product (/grants, /api/grants/search, its events and pricing are
 * untouched).
 *
 * HONESTY CONTRACT (unchanged from federal #399): open only with a published
 * closing date that has not passed (ET day boundary, inclusive) or an explicit
 * source-declared ongoing program; a forecast's announced date lives in
 * estimated_close_date and is never a close_date; an unconfirmable record is
 * never open. See db/migrations/043_state_grants.sql for the full contract.
 *
 * Mirrored in src/db/schema.sql (canonical merged schema, applied by
 * `bun run src/db/setup.ts`) and in db/migrations/043_state_grants.sql (the
 * record). NOT applied to production in this PR.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-043] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);

async function run(label: string, q: string) {
  try {
    await sql`${sql.unsafe(q)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

await run(
  "state_grant_opportunities",
  `CREATE TABLE IF NOT EXISTS state_grant_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    agency TEXT,
    summary TEXT,
    status TEXT NOT NULL CHECK (status IN ('open', 'forecast', 'closed')),
    posted_date DATE,
    close_date DATE,
    estimated_close_date DATE,
    url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    source_updated_at TIMESTAMPTZ,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT state_grant_opportunities_state_external_key
        UNIQUE (state_code, external_id)
  )`,
);

await run(
  "idx_state_grant_opportunities_state_status",
  `CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_status
     ON state_grant_opportunities (state_code, status)`,
);

await run(
  "idx_state_grant_opportunities_state_close_date",
  `CREATE INDEX IF NOT EXISTS idx_state_grant_opportunities_state_close_date
     ON state_grant_opportunities (state_code, close_date)`,
);

await run(
  "state_grant_sync_runs",
  `CREATE TABLE IF NOT EXISTS state_grant_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    fetched_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    error JSONB
  )`,
);

await run(
  "idx_state_grant_sync_runs_state_started",
  `CREATE INDEX IF NOT EXISTS idx_state_grant_sync_runs_state_started
     ON state_grant_sync_runs (state_code, started_at DESC)`,
);

await run(
  "state_grant_registry",
  `CREATE TABLE IF NOT EXISTS state_grant_registry (
    state_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unavailable', 'connected')),
    connector_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
);

console.log("[run-043] complete");
