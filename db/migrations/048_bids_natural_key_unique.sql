-- Migration 048 — bids: make the natural key a UNIQUE index (owner 2026-09-22,
-- run-level dedupe hardening for the concurrent Phase-2 sources).
--
-- WHY: the runner's two guards cannot close a same-run race between two
-- CONCURRENT state-keyword sources (Phase 2, Promise.all of 5 + 1 tail): both
-- sources evaluate WHERE NOT EXISTS against the snapshot taken before their own
-- statement, so both insert. (source, external_id) does not help — each source
-- stamps its own prefix. Measured in production: 4,059 duplicate groups /
-- 14,690 rows under this key, including rows created 2026-09-21.
--
-- GRANDFATHERED ON PURPOSE: 4,059 of those groups already exist, so a full-table
-- unique index cannot be built (it would fail). The predicate limits enforcement
-- to rows inserted from the cutover forward — exactly the rows a future run can
-- race on. The full form requires an owner-gated reconciliation pre-step.
--
-- PG 18.6: NULLS NOT DISTINCT (PG15+) is REQUIRED — notice_type and psc are NULL
-- on every row involved (the state-keyword collectors do not populate them), and
-- a plain UNIQUE would treat those NULLs as distinct and admit both copies.
-- COALESCE(text,'') matches the in-memory key in src/jobs/runner.ts
-- (batchInsertNaturalKey maps NULL -> "") so SQL and TS enforce ONE key.
--
-- NOT APPLIED BY THIS PR. db/migrations/run-048.ts is the by-hand runner.
-- Mirrored in src/db/schema.sql.
--
-- FROZEN CUTOFF: the WHERE literal below is a freeze point (design §7 item 4).
-- It is never edited by a later migration — any re-adoption of the constraint is
-- a NEW migration, because this statement is `IF NOT EXISTS` and therefore
-- self-disabling on re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_natural_key_unique
  ON bids (
    lower(btrim(title)),
    lower(btrim(agency)),
    COALESCE(notice_type, ''),
    due_date,
    COALESCE(psc, '')
  )
  NULLS NOT DISTINCT
  WHERE created_at >= TIMESTAMPTZ '2026-09-22 00:00:00+00';
