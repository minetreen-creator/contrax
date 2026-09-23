-- Migration 049 — collector_staleness must reflect REALITY (owner-locked
-- nationwide correctness FIX ②, 2026-09-23: "stop treating dead collectors as
-- fresh").
--
-- THE BUG (audit + live probe 2026-09-23): the view computed its tier from
-- `max(ran_at)` ALONE. `nys_socrata` — a DEAD source whose two data.ny.gov SODA
-- datasets both answer HTTP 404 (verified live) and whose list fetch swallowed
-- the 404, returning an empty array — therefore reported **FRESH** for 43
-- consecutive runs (2026-09-13 → 2026-09-23): rows_fetched 0, rows_new 0,
-- errors 0, ran_zero true, and ZERO rows ever stored in `bids`. A dead source
-- was indistinguishable from a healthy one on the health surface.
--
-- THE FIX: the tier is derived from the LATEST run per source, and it accounts
-- for the run's OUTCOME, not just its timestamp. Same rule as
-- `src/lib/collector-freshness.ts` (which is unit-tested; this file is its SQL
-- twin — the two must stay in step):
--
--   errors > 0 AND rows_fetched = 0  -> 'DEAD'      could not read the source
--   errors > 0                       -> 'FAILED'    partial failure
--   rows_fetched = 0                 -> 'EMPTY'     honest zero (e.g. 4841xx
--                                                   passes that legitimately
--                                                   matched nothing)
--   < 48h                            -> 'FRESH'
--   <= 7d                            -> 'STALE'
--   else                             -> 'CRITICAL'
--
-- DEAD / FAILED / EMPTY are all NOT fresh: a zero-yield or failed collector can
-- never again be reported as fresh, while an honest empty pass stays
-- DISTINGUISHABLE from a dead source (the audit's taxonomy). A source that never
-- ran stays 'CRITICAL'.
--
-- ADDITIVE / IDEMPOTENT: `CREATE OR REPLACE VIEW` with new columns APPENDED at
-- the end (Postgres only permits that, and it is why `errors` is the last
-- column). No table, no row, no column of `bids` is touched, and nothing writes.
--
-- DELIBERATE SEMANTIC CHANGES (reviewed, both previously meaningless next to a
-- freshness tier, and the view had NO reader in `src/` — audit cross-check H-1):
--   * `rows_fetched` was `sum()` over EVERY run; it is now the LATEST run's
--     count (`::bigint` keeps the existing column type, which
--     `CREATE OR REPLACE VIEW` cannot change);
--   * `ran_zero` was `bool_and` over every run; it is now the LATEST run's
--     flag ("did the most recent attempt fetch nothing?");
--   * NEW trailing column `errors` = the latest run's error count, so a DEAD or
--     FAILED tier can be explained without a second query.
--   * the 48-hour / 7-day window comparisons became INCLUSIVE (`>=`, they were
--     strict `>` in run-039's view) so the SQL is the classifier's EXACT twin:
--     `src/lib/collector-freshness.ts` is inclusive at both boundaries
--     (`ageHours <= FRESH_WINDOW_HOURS`, `<= STALE_WINDOW_DAYS * 24`), and the
--     unit suite pins exactly that (48h ⇒ FRESH, 7d ⇒ STALE). The two
--     definitions previously disagreed at the instant of the boundary, which is
--     the one thing a "single definition, two implementations" fix must not do.
--
-- ROLLBACK: re-run db/migrations/run-039.ts's view statement (the previous
-- definition) — data-preserving, no writes.

CREATE OR REPLACE VIEW collector_staleness AS
SELECT latest.source,
       latest.last_run_at,
       latest.rows_fetched::bigint AS rows_fetched,
       latest.ran_zero,
       latest.tier,
       latest.errors::bigint AS errors
FROM (
  SELECT DISTINCT ON (source)
         source,
         ran_at AS last_run_at,
         rows_fetched,
         ran_zero,
         errors,
         CASE
           WHEN errors > 0 AND rows_fetched = 0 THEN 'DEAD'
           WHEN errors > 0 THEN 'FAILED'
           WHEN rows_fetched = 0 THEN 'EMPTY'
           WHEN ran_at >= now() - interval '48 hours' THEN 'FRESH'
           WHEN ran_at >= now() - interval '7 days' THEN 'STALE'
           ELSE 'CRITICAL'
         END AS tier
  FROM collector_run_log
  ORDER BY source, ran_at DESC, id DESC
) latest
UNION ALL
SELECT x.source_name,
       NULL::timestamptz,
       NULL::bigint,
       NULL::boolean,
       'CRITICAL'::text,
       NULL::bigint
FROM (VALUES ('sam_gov'),('cities'),('pennbid'),('va_evirginia'),('pa'),('va')) AS x(source_name)
WHERE x.source_name NOT IN (SELECT source FROM collector_run_log);
