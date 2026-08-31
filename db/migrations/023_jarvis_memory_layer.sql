-- Migration 023 — Jarvis Autonomous Upgrade, Phase 1: durable MEMORY LAYER.
--
-- Owner directive 2026-08-31. This phase is PURE PERSISTENT STORAGE + approved
-- knowledge seed. It introduces NO autonomy: no scheduler, no problem-solver,
-- no /jarvis/brain UI, no writes from the existing interactive Jarvis path.
-- Every table below is a durable ledger for the supervised autonomous
-- assistant that LATER phases will consume. No existing behavior is touched.
--
-- Conventions follow the repo: BIGSERIAL ids, TIMESTAMPTZ timestamps defaulting
-- to NOW(), snake_case, JSONB for shape-flexible evidence/metrics, CHECK-constrained
-- enums for status/confidence/severity, and idempotent DDL (IF NOT EXISTS) so the
-- migration is safe to re-run on any environment.
--
-- Semantics the later phases rely on:
--   • owner_approved=false records are CANDIDATES, not facts (see store).
--   • superseded_by / superseded_at soft-retire records; owner-approved rows are
--     never hard-deleted.
--   • expires_at marks memory as stale (treat as not-live once passed).

-- ─────────────────────────  jarvis_memory  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_memory (
  id             BIGSERIAL PRIMARY KEY,
  category       TEXT        NOT NULL,
  fact           TEXT        NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'jarvis',
  confidence     REAL        NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  owner_approved BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  superseded_by  BIGINT      REFERENCES jarvis_memory(id)
);
CREATE INDEX IF NOT EXISTS jarvis_memory_approved_category_idx ON jarvis_memory (owner_approved, category);
CREATE INDEX IF NOT EXISTS jarvis_memory_category_idx        ON jarvis_memory (category);
CREATE INDEX IF NOT EXISTS jarvis_memory_source_idx          ON jarvis_memory (source);
CREATE INDEX IF NOT EXISTS jarvis_memory_superseded_by_idx   ON jarvis_memory (superseded_by);

-- ─────────────────────────  jarvis_decisions  ─────────────────────────
-- Owner-approved strategic/commercial decisions (the "approved decisions" tier
-- of the data-priority rule). Non-approved rows are pending candidates.
CREATE TABLE IF NOT EXISTS jarvis_decisions (
  id             BIGSERIAL PRIMARY KEY,
  decision       TEXT        NOT NULL,
  rationale      TEXT,
  owner_approved BOOLEAN     NOT NULL DEFAULT FALSE,
  effective_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jarvis_decisions_owner_approved_idx ON jarvis_decisions (owner_approved);
CREATE INDEX IF NOT EXISTS jarvis_decisions_effective_at_idx   ON jarvis_decisions (effective_at);
CREATE INDEX IF NOT EXISTS jarvis_decisions_created_at_idx     ON jarvis_decisions (created_at);

-- ─────────────────────────  jarvis_problems  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_problems (
  id                 BIGSERIAL PRIMARY KEY,
  category           TEXT        NOT NULL,
  title              TEXT        NOT NULL,
  description        TEXT,
  severity           TEXT        NOT NULL DEFAULT 'INFO'
                     CHECK (severity IN ('INFO','WATCH','IMPORTANT','CRITICAL')),
  confidence         REAL        NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  evidence           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status             TEXT        NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','investigating','resolved','dismissed')),
  owner_acknowledged BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jarvis_problems_status_idx      ON jarvis_problems (status);
CREATE INDEX IF NOT EXISTS jarvis_problems_detected_at_idx ON jarvis_problems (detected_at);
CREATE INDEX IF NOT EXISTS jarvis_problems_severity_idx    ON jarvis_problems (severity);

-- ─────────────────────────  jarvis_hypotheses  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_hypotheses (
  id                    BIGSERIAL PRIMARY KEY,
  problem_id            BIGINT      REFERENCES jarvis_problems(id),
  hypothesis            TEXT        NOT NULL,
  supporting_evidence   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  contradicting_evidence JSONB      NOT NULL DEFAULT '[]'::jsonb,
  confidence            REAL        NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status                TEXT        NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed','testing','active','accepted','rejected','superseded')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jarvis_hypotheses_problem_id_idx ON jarvis_hypotheses (problem_id);
CREATE INDEX IF NOT EXISTS jarvis_hypotheses_status_idx     ON jarvis_hypotheses (status);

-- ─────────────────────────  jarvis_experiments  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_experiments (
  id             BIGSERIAL PRIMARY KEY,
  hypothesis_id  BIGINT      REFERENCES jarvis_hypotheses(id),
  name           TEXT        NOT NULL,
  baseline_metric TEXT,
  target_metric  TEXT,
  baseline_value REAL,
  target_value   REAL,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  owner_approved BOOLEAN     NOT NULL DEFAULT FALSE,
  status         TEXT        NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','running','completed','aborted')),
  result         TEXT,
  conclusion     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jarvis_experiments_hypothesis_id_idx ON jarvis_experiments (hypothesis_id);
CREATE INDEX IF NOT EXISTS jarvis_experiments_status_idx        ON jarvis_experiments (status);

-- ─────────────────────────  jarvis_feedback  ─────────────────────────
-- Owner feedback on recommendations Jarvis produced. `recommendation_id` is a
-- plain identifier (no FK yet): a recommendations ledger arrives in a later
-- phase; keeping it unconstrained lets feedback be written against whatever
-- identifier the producer uses without a chained migration.
CREATE TABLE IF NOT EXISTS jarvis_feedback (
  id                BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT      NOT NULL,
  accepted          BOOLEAN,
  owner_rating      SMALLINT    CHECK (owner_rating BETWEEN 1 AND 5),
  owner_comment     TEXT,
  expected_result   TEXT,
  actual_result     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jarvis_feedback_recommendation_id_idx ON jarvis_feedback (recommendation_id);

-- ─────────────────────────  jarvis_outcomes  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_outcomes (
  id                 BIGSERIAL PRIMARY KEY,
  subject_type       TEXT        NOT NULL,
  subject_id         TEXT        NOT NULL,
  metric             TEXT        NOT NULL,
  before_value       JSONB,
  after_value        JSONB,
  observation_window TEXT,
  conclusion         TEXT,
  confidence         REAL        CHECK (confidence >= 0 AND confidence <= 1),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jarvis_outcomes_subject_idx ON jarvis_outcomes (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS jarvis_outcomes_created_at_idx ON jarvis_outcomes (created_at);

-- ─────────────────────────  jarvis_tasks  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_tasks (
  id                     BIGSERIAL PRIMARY KEY,
  task_type              TEXT        NOT NULL,
  title                  TEXT        NOT NULL,
  instructions           TEXT,
  authority_level        TEXT        NOT NULL DEFAULT 'L0'
                         CHECK (authority_level IN ('L0','L1','L2','L3','L4','L5')),
  status                 TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','scheduled','running','completed','failed','cancelled','awaiting_approval')),
  created_by             TEXT,  -- 'system' or an admin identifier
  scheduled_for          TIMESTAMPTZ,
  started_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  result                 TEXT,
  requires_owner_approval BOOLEAN   NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS jarvis_tasks_status_idx           ON jarvis_tasks (status);
CREATE INDEX IF NOT EXISTS jarvis_tasks_scheduled_for_idx    ON jarvis_tasks (scheduled_for);
CREATE INDEX IF NOT EXISTS jarvis_tasks_authority_level_idx  ON jarvis_tasks (authority_level);

-- ─────────────────────────  jarvis_runs  ─────────────────────────
CREATE TABLE IF NOT EXISTS jarvis_runs (
  id                       BIGSERIAL PRIMARY KEY,
  run_type                 TEXT        NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  status                   TEXT        NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','completed','failed')),
  findings_count           INTEGER     NOT NULL DEFAULT 0,
  problems_detected        INTEGER     NOT NULL DEFAULT 0,
  recommendations_created  INTEGER     NOT NULL DEFAULT 0,
  safe_actions_taken       INTEGER     NOT NULL DEFAULT 0,
  errors                   JSONB       NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS jarvis_runs_run_type_idx      ON jarvis_runs (run_type);
CREATE INDEX IF NOT EXISTS jarvis_runs_started_at_idx    ON jarvis_runs (started_at);
CREATE INDEX IF NOT EXISTS jarvis_runs_status_idx        ON jarvis_runs (status);

-- ─────────────────────────  owner_status  ─────────────────────────
-- SINGLE-ROW table (enforced: only id = 1 may exist). The autonomous worker
-- and the owner's "available / away / do_not_disturb" presence map to it.
CREATE TABLE IF NOT EXISTS owner_status (
  id           INTEGER     PRIMARY KEY CHECK (id = 1),
  availability TEXT        NOT NULL DEFAULT 'available'
               CHECK (availability IN ('available','away','do_not_disturb')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seed the single row so lookups never 0-row their way to a wrong default.
INSERT INTO owner_status (id, availability, updated_at)
VALUES (1, 'available', NOW())
ON CONFLICT (id) DO NOTHING;
