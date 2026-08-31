-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 — Jarvis Autonomous Upgrade, Phase 5: SCHEDULED SUPERVISED WORKER.
--
-- Owner directive (ratified business plan rev 132): a secure server-side worker
-- independent of the browser, running on a schedule (hourly health / every 4h
-- bid·feed·usage·radar·funnel / daily-am Executive Brief / daily-pm review +
-- hypotheses / weekly deep strategy), with `jarvis_runs` AUDIT LOGGING
-- (trigger, readers, metrics, problems, hypotheses, recommendations, records
-- modified, safe actions, refused + reason, status) and `owner_status` AWAY MODE
-- + a KILL SWITCH.
--
-- Phase 5 is PURELY ADDITIVE. It only ADDS the audit-log columns the worker
-- needs to `jarvis_runs` and the Away-Mode / kill-switch flag to `owner_status`
-- (migration 023 already seeded the single owner_status row). No existing column,
-- table, constraint, or behavior is changed: the original `jarvis_runs` columns
-- (status IN ('running','completed','failed'), findings_count,
-- problems_detected, recommendations_created, safe_actions_taken, errors) are
-- all still used exactly as before — the new columns are additive audit detail.
-- `status` keeps its existing enum; a "refused" run is recorded as status
-- `completed` with `refused = TRUE` + `refused_reason`, so no CHECK constraint is
-- altered.
--
-- Conventions follow migrations 023/024: idempotent DDL (IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS), TIMESTAMPTZ, snake_case, JSONB for shape-flexible
-- audit detail, and every statement safe to re-run on any environment.
-- ─────────────────────────────────────────────────────────────────────────────

-- jarvis_runs — additive audit-log columns for the scheduled worker.
-- trigger_kind   : which schedule fired (hourly-health | four-hour | daily-am |
--                  daily-pm | weekly | manual).
-- readers        : labels of the retrieval readers that supplied this run's data.
-- metrics        : aggregated, grounded metric lines { tool → lines[] }.
-- note           : free-form brief (Executive Brief / review / strategy / return brief).
-- refused        : TRUE when the run was refused (kill switch / away / DND).
-- refused_reason : machine+human reason for the refusal.
-- hypotheses     : count of hypotheses created/updated during the run.
-- records_modified : count of Jarvis-owned ledger rows changed by the run.
-- safe_actions   : the L3 safe actions auto-run this cycle (audit trail).
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS trigger_kind TEXT;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS readers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS refused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS refused_reason TEXT;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS hypotheses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS records_modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS safe_actions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- owner_status — AWAY MODE + KILL SWITCH (single-row table, id=1 only).
-- kill_switch : when TRUE the scheduled worker refuses ALL work (logged, no
--               side effects) unless an operator flips it back to FALSE.
ALTER TABLE owner_status ADD COLUMN IF NOT EXISTS kill_switch BOOLEAN NOT NULL DEFAULT FALSE;
