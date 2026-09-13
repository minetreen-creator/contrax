/**
 * Migration 039 — Radar ingestion observability + state coverage (PR-B).
 *
 * Scope (owner-authorized v4 split; additive ONLY — zero destructive changes,
 * no CHECK constraints by design, no runtime schema detection):
 *
 * 1. Additive columns on `bids` (nullable, no CHECK):
 *      source_jurisdiction text  — the collector's home jurisdiction (e.g. 'PA')
 *      raw_location        text  — verbatim pre-normalization location value
 *      normalized_state    text  — 2-letter state, only when PROVABLE
 *      location_conflict   bool  — true when the row's own text names a
 *                                  different state than its normalized state
 *    Backfill uses ONLY real, currently-in-DB source data: source_jurisdiction
 *    = the row's own `source`; raw_location = the row's own `location`;
 *    normalized_state is derived conservatively from location/agency text via
 *    state-code/state-name patterns — rows with no provable state stay NULL
 *    (never guessed); location_conflict is set only for rows whose own
 *    title/description names a state code or name DIFFERENT from the
 *    normalized one (honest flag only — no row is excluded or relabeled).
 *
 * 2. collector_run_log — a per-run log (who ran, when, how many rows fetched,
 *    how many were new, ran_zero) so "collector ran and returned zero" (honest,
 *    provable) is distinguishable from "collector never ran" (defect). Written
 *    by the existing GH Actions sync path (runner.ts syncSource).
 *
 * 3. collector_staleness VIEW — FRESH (<48h) / STALE (<=7d) / CRITICAL (>7d or
 *    never) per source, surfaced for ops and alerting. This is what flags
 *    va_evirginia (last real run 2026-08-29) as CRITICAL until the repaired
 *    source syncs.
 *
 * 4. collector_collapse_log + a collapse alert VIEW — records syncs where a
 *    collector returned many source rows but almost none became NEW rows, the
 *    observable signature of the PA 11→0 collapse (dedupe storms or a
 *    zero-visible-result defect); alertable, never silent.
 *
 * Idempotent: every DDL is IF [NOT] EXISTS-guarded; safe to re-run.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run(label: string, q: string) {
  try {
    await sql`${sql.unsafe(q)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

// 1a. Additive columns (nullable, no CHECK — honest data contract).
await run(
  "bids: additive location columns",
  `
  ALTER TABLE bids
    ADD COLUMN IF NOT EXISTS source_jurisdiction text,
    ADD COLUMN IF NOT EXISTS raw_location text,
    ADD COLUMN IF NOT EXISTS normalized_state text,
    ADD COLUMN IF NOT EXISTS location_conflict boolean;
  `,
);

// 1b. Backfill from real in-DB data only (never guess):
//   - source_jurisdiction  <- the row's own source label.
//   - raw_location         <- the row's own pre-normalization location value.
//   - normalized_state     <- provable 2-letter state from location/agency text
//                             (conservative: full-name/st-code token match,
//                             "Unknown"/empty -> NULL).
//   - location_conflict    <- row text names a DIFFERENT state than normalized.
await run(
  "bids: backfill state columns from in-DB data",
  `
  WITH state_codes AS (
    SELECT * FROM (VALUES
      ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),
      ('CA','California'),('CO','Colorado'),('CT','Connecticut'),('DE','Delaware'),
      ('DC','District of Columbia'),('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),
      ('ID','Idaho'),('IL','Illinois'),('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),
      ('KY','Kentucky'),('LA','Louisiana'),('ME','Maine'),('MD','Maryland'),
      ('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),('MS','Mississippi'),
      ('MO','Missouri'),('MT','Montana'),('NE','Nebraska'),('NV','Nevada'),
      ('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),
      ('NC','North Carolina'),('ND','North Dakota'),('OH','Ohio'),('OK','Oklahoma'),
      ('OR','Oregon'),('PA','Pennsylvania'),('RI','Rhode Island'),('SC','South Carolina'),
      ('SD','South Dakota'),('TN','Tennessee'),('TX','Texas'),('UT','Utah'),
      ('VT','Vermont'),('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),
      ('WI','Wisconsin'),('WY','Wyoming')
    ) AS s(code, name)
  ),
  with_state AS (
    SELECT b.id,
      sc.code AS st
    FROM bids b
    CROSS JOIN state_codes sc
    WHERE b.location IS NOT NULL
      AND (
        -- "City, ST" / "(ST)" / "ST." free tokens in location
        b.location ~* ('(^|[\\s,(])' || sc.code || '([\\s,).]|$)')
        OR b.location ~* ('(^|[\\s,])' || sc.name || '([\\s,.]|$)')
      )
  ),
  conflict AS (
    SELECT b.id,
      bool_or(
        b.title ~* ('(^|[\\s,(])' || sc.code || '([\\s,).]|$)')
        OR b.title ~* ('(^|[\\s,])' || sc.name || '([\\s,.]|$)')
        OR b.description ~* ('(^|[\\s,(])' || sc.code || '([\\s,).]|$)')
        OR b.description ~* ('(^|[\\s,])' || sc.name || '([\\s,.]|$)')
      ) AS names_other_state
    FROM bids b
    CROSS JOIN state_codes sc
    JOIN with_state ws ON ws.id = b.id AND ws.st IS DISTINCT FROM sc.code
    GROUP BY b.id
  )
  UPDATE bids b
  SET source_jurisdiction = b.source,
      raw_location = b.location,
      normalized_state = ws.st,
      location_conflict = COALESCE(cf.names_other_state, false)
  FROM with_state ws
  LEFT JOIN conflict cf ON cf.id = b.id
  WHERE b.id = ws.id;
  `,
);

// 2. Collector run-log (each sync run per collector).
await run(
  "collector_run_log table",
  `
  CREATE TABLE IF NOT EXISTS collector_run_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL,
    ran_at timestamptz NOT NULL DEFAULT now(),
    rows_fetched integer NOT NULL DEFAULT 0,
    rows_new integer NOT NULL DEFAULT 0,
    ran_zero boolean NOT NULL DEFAULT false,
    errors integer NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_collector_run_log_source_ran
    ON collector_run_log (source, ran_at DESC);
  `,
);

// 3. Staleness tier view — FRESH | STALE | CRITICAL (per source, incl. never-run).
await run(
  "collector_staleness view",
  `
  CREATE OR REPLACE VIEW collector_staleness AS
  SELECT s.source,
         s.last_run_at,
         s.rows_fetched,
         s.ran_zero,
         CASE
           WHEN s.last_run_at IS NULL THEN 'CRITICAL'
           WHEN s.last_run_at > now() - interval '48 hours' THEN 'FRESH'
           WHEN s.last_run_at > now() - interval '7 days' THEN 'STALE'
           ELSE 'CRITICAL'
         END AS tier
  FROM (
    SELECT source,
           max(ran_at) AS last_run_at,
           sum(rows_fetched) AS rows_fetched,
           bool_and(ran_zero) AS ran_zero
    FROM collector_run_log
    GROUP BY source
  ) s
  UNION ALL
  SELECT source_name, NULL, NULL, NULL, 'CRITICAL'
  FROM (VALUES ('sam_gov'),('cities'),('pennbid'),('va_evirginia'),('pa'),('va')) AS x(source_name)
  WHERE source_name NOT IN (SELECT source FROM collector_run_log);
  `,
);

// 4. Collapse observability — the PA 11-source-rows -> 0-visible-results
//    signature: many fetched, ~zero new (dedupe/collapse storm) or ran_zero.
await run(
  "collector_collapse_log table",
  `
  CREATE TABLE IF NOT EXISTS collector_collapse_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    rows_fetched integer NOT NULL DEFAULT 0,
    rows_new integer NOT NULL DEFAULT 0,
    note text
  );
  `,
);
await run(
  "collector_collapse_alert view",
  `
  CREATE OR REPLACE VIEW collector_collapse_alert AS
  SELECT source, occurred_at, rows_fetched, rows_new,
         (rows_fetched - rows_new) AS collapsed,
         CASE WHEN rows_fetched > 0 AND rows_new = 0 THEN 'COLLAPSE'
              WHEN rows_fetched > 10 AND rows_new <= rows_fetched / 4 THEN 'HEAVY_DEDUPE'
              ELSE 'OK' END AS severity
  FROM collector_collapse_log
  ORDER BY occurred_at DESC;
  `,
);

console.log("[run-039] complete");