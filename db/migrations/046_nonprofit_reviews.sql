-- Migration 046 — Nonprofit Free phase 2: the append-only review/audit table, the
-- EIN-release column + partial unique index, and the digest columns.
--
-- ADDITIVE + IDEMPOTENT + SPLITTABLE: every statement below is safe to re-run any
-- number of times, and no statement contains a `;` (see db/migrations/sql-statements.ts
-- for why — the runner and the test provisioning both execute this file statement by
-- statement). Replayed by db/migrations/run-046.ts (`bun run db/migrations/run-046.ts`).
-- NOT wired into CI, a test, or a schedule: like run-045 it is run BY HAND, once, at
-- phase merge.
--
-- WHAT THIS IS, AND WHY EACH PIECE EXISTS
--
-- 1. nonprofit_application_reviews — the owner's "notes + audit history"
--    (spec item 4, appendix decision 3). The application row itself carries only ONE
--    reviewed_by/reviewed_at/review_notes triple (045), so a second action would
--    OVERWRITE the first. This table is APPEND-ONLY: one row per admin action, with the
--    action, the acting administrator's immutable user id + email, an optional reason
--    code and internal note, and the status BEFORE and AFTER. It is also the queue's
--    SLA trail. Because it is shaped for (approve|deny|suspend|release|transfer) from
--    the start, the phase-2 unit B admin API adds no DDL.
--
-- 2. nonprofit_applications.released_at — the owner's locked decision (2026-09-21):
--    "Denied/revoked EIN — release/transfer ONLY via explicit admin action. No
--    automatic cooldown." A denied or revoked EIN stays attached to its account until
--    an administrator releases or transfers it; release sets this column (an admin
--    action, unit B) and the released row is NEVER deleted — the org keeps its data.
--
--    The UNIQUE index on `ein` therefore becomes PARTIAL: `WHERE released_at IS NULL`.
--    That is the one-column change tolerance the build plan required, and it is what
--    makes a released EIN immediately claimable by a DIFFERENT applicant while an
--    attached (released_at IS NULL) EIN still permits exactly one free org account.
--    DROP + CREATE with the SAME NAME keeps run-045's shape self-check green (its
--    `CREATE UNIQUE INDEX IF NOT EXISTS` becomes a no-op once this index exists) and
--    keeps the phase-1 source-text assertion true (the partial CREATE line still
--    contains "nonprofit_applications_ein_key ON nonprofit_applications (ein)").
--    UNIQUE (user_id) is untouched: one application row per user, forever.
--
-- 3. digest_opt_out_at / digest_unsubscribe_token_hash / digest_last_sent_at — the
--    weekly deadline digest columns (build plan §5). Declared HERE, with the rest of
--    phase 2's DDL, so the later digest unit writes no migration. Nothing in this
--    phase reads them; `digest_opt_out_at` is never cleared once set.
--
-- NOT HERE, ON PURPOSE: no Stripe column, no `plan_tier`, no `grants_subscriptions`
-- write, no change to any existing row. Mirrored in src/db/schema.sql (the canonical
-- merged schema applied by `bun run db/setup.ts`).
CREATE TABLE IF NOT EXISTS nonprofit_application_reviews (
    id SERIAL PRIMARY KEY,
    -- ON DELETE is deliberately absent: an application row is never deleted (the
    -- owner's rule: a status change never destroys the account or its data), so the
    -- audit trail can never be orphaned by a cascade.
    application_id INTEGER NOT NULL REFERENCES nonprofit_applications (id),
    -- The owner's action list (appendix decision 3).
    action TEXT NOT NULL CHECK (action IN ('approve', 'deny', 'suspend', 'release', 'transfer')),
    -- The acting administrator's IMMUTABLE user id (and email as displayed at the
    -- time), e.g. `user:18 <minetreen@gmail.com>` split across the two columns. Never a
    -- generic label like "agent-lead".
    actor_user_id INTEGER NOT NULL REFERENCES users (id),
    actor_email TEXT NOT NULL,
    -- Optional: a machine-readable reason for the action (e.g. 'fraud-likely',
    -- 'irs_status_changed', 'wrong_org'), never required, never invented.
    reason_code TEXT,
    -- Optional: the reviewer's internal note. Internal means internal: it is never
    -- rendered to an applicant.
    internal_note TEXT,
    prior_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The queue's history read: one application's actions in order.
CREATE INDEX IF NOT EXISTS idx_nonprofit_application_reviews_application
    ON nonprofit_application_reviews (application_id, created_at);
ALTER TABLE nonprofit_applications ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE nonprofit_applications ADD COLUMN IF NOT EXISTS digest_opt_out_at TIMESTAMPTZ;
ALTER TABLE nonprofit_applications ADD COLUMN IF NOT EXISTS digest_unsubscribe_token_hash TEXT;
ALTER TABLE nonprofit_applications ADD COLUMN IF NOT EXISTS digest_last_sent_at TIMESTAMPTZ;
DROP INDEX IF EXISTS nonprofit_applications_ein_key;
CREATE UNIQUE INDEX IF NOT EXISTS nonprofit_applications_ein_key
    ON nonprofit_applications (ein) WHERE released_at IS NULL;
