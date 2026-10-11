-- Migration 060 — CRM Professional follow-up reminders (owner handoff 2026-10-10,
-- item 4: "Professional reminders: Show upcoming and overdue follow-ups. If
-- implementing email delivery, require an opt-in preference. Use the user's
-- timezone. Recheck entitlement before delivery. Use a delivery ledger/idempotency
-- key and retries to prevent duplicates. Implement the scheduled worker; the code
-- above does not send reminders.").
--
-- PHASE 3a of 3 (3b = pricing copy, 3c = the verification matrix — neither is in
-- this migration). It is the schema half of the OPT-IN email delivery the owner
-- asks for, and it carries the two things that make delivery safe:
--
--   (1) user_crm_prefs — the OPT-IN PREFERENCE and the user's TIMEZONE.
--       `reminders_opt_in` DEFAULTS TO FALSE, so the absence of a row (and the
--       absence of consent) both mean "do not email". No row is created for any
--       existing user, nothing is back-filled, and no column here grants a tier:
--       the entitlement still comes ONLY from src/lib/crm-access.server.ts
--       (subscription_status / trial state / admin), exactly as in phase 1.
--
--   (2) crm_reminder_deliveries — the DELIVERY LEDGER. One row per
--       (user, saved bid, follow-up date) window, whose UNIQUE idempotency_key is
--       what makes DUPLICATE DELIVERY IMPOSSIBLE: a re-run, a retry or a second
--       concurrent worker cannot insert a second row for the same window, and the
--       worker never emails a window whose row already records an attempt. The
--       row is a LOG (delivered_at = NULL while the attempt is unconfirmed), not a
--       copy of the saved bid; `follow_up_date` itself still lives ONLY on
--       saved_matches and is never duplicated into a new notion of "reminder".
--
-- ADDITIVE ONLY: two NEW tables plus their indexes, and ONE composite
-- ownership foreign key. Nothing is dropped, renamed, defaulted or back-filled:
--   * user_crm_prefs starts EMPTY — reminders are OPT-IN, and an empty table is
--     the honest state (nobody has opted in, so nobody is emailed).
--   * crm_reminder_deliveries starts EMPTY — this migration sends nothing.
--   * The only statement touching an EXISTING table is a new UNIQUE index on
--     saved_matches (user_id, id). It adds no column, changes no row, and exists
--     so the ledger's ownership FK below can be a COMPOSITE key — a ledger row
--     can then never point at another user's saved bid, even if a row were
--     mis-keyed (the same rigor migration 059 applied to
--     saved_matches.crm_contact_id). Because `id` is already the table's PRIMARY
--     KEY the pair is trivially unique, so the index cannot fail on real data.
--
-- FK-IDEMPOTENCY GUARD: Postgres has NO `ALTER TABLE … ADD CONSTRAINT IF NOT
-- EXISTS`, so the composite FK is wrapped in a `DO $$ … $$` guard that checks
-- pg_constraint by NAME before adding it (the migration-059 pattern). It is the
-- ONLY statement here that is not natively idempotent; everything else is
-- `CREATE … IF NOT EXISTS`. Because of that DO block, run-060.ts splits this file
-- with the dollar-quote-aware `schemaStatements()` from
-- db/migrations/sql-statements.ts, not `migrationStatements()`.
--
-- PROTOCOL: applied BY HAND by the lead (operator) — PROD-FIRST, BEFORE this
-- feature's code deploys — exactly like migrations 047/051/052/053/058/059. It is
-- NOT run by any test, CI job or scheduled task (the DELIBERATE-ONLY guard in
-- run-060.ts). In this sandbox the DATABASE_URL in the environment IS production,
-- which is why the runner prints its target host first.
--
-- WHY src/db/schema.sql IS DELIBERATELY NOT MIRRORED (same reasoning as 059):
-- the canonical merged schema is consumed by `splitSqlStatements()` in
-- src/db/migrate.ts, which does not understand a `DO $$ … $$` block the way
-- schemaStatements() does. Mirroring the two tables WITHOUT the guarded FK would
-- let a schema.sql-bootstrapped database differ from production in the one place
-- this migration exists to guarantee. A schema.sql mirror is a separate,
-- reviewable change (it needs src/db/migrate.ts to adopt the dollar-quote-aware
-- splitter first).
--
-- ROLLBACK (in this order — all safe, nothing else references these objects):
--   ALTER TABLE crm_reminder_deliveries DROP CONSTRAINT IF EXISTS crm_reminder_deliveries_saved_match_owner_fk;
--   DROP TABLE IF EXISTS crm_reminder_deliveries;
--   DROP TABLE IF EXISTS user_crm_prefs;
--   DROP INDEX IF EXISTS saved_matches_user_id_id_uniq;
-- (The two tables are new and empty on a freshly-migrated database; dropping them
-- discards reminder preferences and delivery history only once a user has
-- actually opted in. The saved_matches index is dropped LAST because the FK
-- depends on it; dropping it first would be refused or would drop the FK
-- implicitly.)
CREATE TABLE IF NOT EXISTS user_crm_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- OPT-IN. Defaults to FALSE and is only ever set to TRUE by the user's own
    -- request through POST /api/crm { action: "saveReminderPrefs" }. Nothing in
    -- this migration, the worker or any other job may flip it.
    reminders_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    -- The user's IANA timezone, used to decide which LOCAL calendar day a
    -- follow_up_date falls on. Defaults to UTC; the write path only stores a
    -- value the runtime's Intl accepts (src/lib/crm-reminders.ts validates it).
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_reminder_deliveries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The saved bid the reminder was about. Covered by the composite ownership FK
    -- below together with user_id — never a bare id.
    saved_match_id INTEGER NOT NULL,
    -- Carried for the email/ledger audit only (the bid's own id); not the key.
    bid_id INTEGER NOT NULL,
    -- The follow-up window this delivery belongs to: the saved_matches
    -- follow_up_date the reminder fires for, as published (a calendar DATE).
    due_on DATE NOT NULL,
    -- The instant the worker decided to send, for audit.
    scheduled_for TIMESTAMPTZ NOT NULL,
    -- NULL until the send is CONFIRMED. A NULL here with a recorded attempt means
    -- the outcome is unknown and the worker must NOT email again.
    delivered_at TIMESTAMPTZ,
    -- How many send attempts have been started for this window. Bumped BEFORE the
    -- mail call, so a crash after the provider accepted the message can never look
    -- like "never attempted".
    attempt_count INTEGER NOT NULL DEFAULT 0,
    -- The dedupe key: '<user_id>:<saved_match_id>:<due_on>' built by
    -- reminderIdempotencyKey() in src/lib/crm-reminders.ts. UNIQUE, so a second
    -- insert for the same window is impossible rather than merely unlikely.
    idempotency_key TEXT NOT NULL,
    -- The provider/transport error of the LAST attempt, NULL when the last
    -- attempt's outcome is unknown. Only a definite failure is retried.
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT crm_reminder_deliveries_attempts_nonneg CHECK (attempt_count >= 0)
);

-- The dedupe guarantee (1 of 2): one row per idempotency key, ever.
CREATE UNIQUE INDEX IF NOT EXISTS crm_reminder_deliveries_idempotency_key_uniq
    ON crm_reminder_deliveries (idempotency_key);
-- The owner's rule stated again, independently of the key's string format: one
-- delivery per (user, saved bid, due window). The second grant of the same
-- guarantee, so a future change to the key's spelling cannot silently weaken it.
CREATE UNIQUE INDEX IF NOT EXISTS crm_reminder_deliveries_user_match_due_uniq
    ON crm_reminder_deliveries (user_id, saved_match_id, due_on);
-- The worker's own read path (one user's ledger, newest window first).
CREATE INDEX IF NOT EXISTS crm_reminder_deliveries_user_due_idx
    ON crm_reminder_deliveries (user_id, due_on);
-- Referenced by the composite FK below. New index only: no column, no row change.
CREATE UNIQUE INDEX IF NOT EXISTS saved_matches_user_id_id_uniq
    ON saved_matches (user_id, id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'crm_reminder_deliveries_saved_match_owner_fk'
    ) THEN
        ALTER TABLE crm_reminder_deliveries
            ADD CONSTRAINT crm_reminder_deliveries_saved_match_owner_fk
            FOREIGN KEY (user_id, saved_match_id) REFERENCES saved_matches (user_id, id);
    END IF;
END $$;
