-- Migration 024 — Jarvis Autonomous Upgrade, Phase 4: AUTONOMY & GOVERNANCE.
--
-- Owner directive (ratified business plan rev 131): authority levels L0–L5; a
-- narrow L3 safe-action allowlist; an L4 owner-approval queue; L5 prohibited;
-- a self-modification ban.
--
-- This phase is PURE GOVERNANCE + queuing. It adds the durable `jarvis_actions`
-- ledger — the OWNER-APPROVAL QUEUE — that the authority engine (src/lib/jarvis/
-- autonomy.ts) and later Phases 5/6 (scheduled worker, /jarvis/brain UI) consume.
-- No existing behavior is touched: no scheduler, no worker, no UI, no changes to
-- the interactive Jarvis path. The classification/decision logic itself is pure
-- and lives in the TypeScript module; this table only persists the queue of
-- owner-approval-required actions and their resolution.
--
-- Semantics:
--   • status 'pending' is the enqueue default. 'approved'/'denied' are set by
--     owner resolution (decided_by/decided_at). 'executed' marks an approved
--     action that has been carried out. 'failed'/'expired' are terminal states.
--   • owner_approved=true marks APPROVED-actions. Per the owner-approved-never-
--     hard-delete principle, a row with owner_approved=true must NEVER be
--     physically deleted (store functions refuse it).
--   • authority_level records the MINIMUM authority the classification returned
--     for this action (L3/L4/L5). L4 rows are exactly the owner-approval queue.
--
-- Conventions follow migration 023: BIGSERIAL ids, TIMESTAMPTZ timestamps
-- defaulting to NOW(), snake_case, JSONB for shape-flexible payloads,
-- CHECK-constrained enums, idempotent DDL (IF NOT EXISTS).

-- ─────────────────────────  jarvis_actions  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_actions (
  id              BIGSERIAL PRIMARY KEY,
  action_type     TEXT        NOT NULL,
  resource        TEXT,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  authority_level TEXT        NOT NULL DEFAULT 'L4'
                  CHECK (authority_level IN ('L0','L1','L2','L3','L4','L5')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','denied','executed','failed','expired')),
  requested_by    TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  decided_by      TEXT,
  reason          TEXT,
  owner_approved  BOOLEAN     NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS jarvis_actions_status_idx          ON jarvis_actions (status);
CREATE INDEX IF NOT EXISTS jarvis_actions_owner_approved_idx  ON jarvis_actions (owner_approved);
CREATE INDEX IF NOT EXISTS jarvis_actions_requested_at_idx    ON jarvis_actions (requested_at);
CREATE INDEX IF NOT EXISTS jarvis_actions_action_type_idx     ON jarvis_actions (action_type);
