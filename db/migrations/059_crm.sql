-- Migration 059 — CRM (contacts + activities + per-account contact cap).
--
-- SOURCE: owner handoff 2026-10-10 (CRM phase 1 of 3). The SQL below is the
-- owner's spec, reconciled against this repo's conventions in exactly two places,
-- both recorded here:
--
--   (1) NUMBERING / LOCATION. The handoff called the record `<next>_crm.sql`. The
--       next FREE number on main is 059 (054 = DOT directory, 055 = contract
--       payments, 056 = contractor operations, 057 = visitors country,
--       058 = tracked-bid source). Nothing was overwritten: this file is
--       db/migrations/059_crm.sql with runner db/migrations/run-059.ts.
--
--   (2) FK-IDEMPOTENCY GUARD. The handoff wrote a plain
--       `ALTER TABLE saved_matches ADD CONSTRAINT saved_matches_crm_contact_owner_fk
--        FOREIGN KEY (user_id, crm_contact_id) REFERENCES crm_contacts (user_id, id);`
--       Postgres has NO `ADD CONSTRAINT IF NOT EXISTS`, so that statement fails
--       loudly on a second run. It is therefore wrapped in a `DO $$ … $$` guard
--       that checks pg_constraint by NAME first. It is the ONLY statement that is
--       not natively idempotent — every other statement is
--       `CREATE … IF NOT EXISTS` or `CREATE OR REPLACE FUNCTION`, so a second
--       invocation re-writes nothing.
--
--       NOTE for the operator: because of that DO block and the PL/pgSQL function
--       body below, run-059.ts splits this file with
--       `schemaStatements()` (the dollar-quote-aware splitter in
--       db/migrations/sql-statements.ts) rather than `migrationStatements()`,
--       which splits on `;` alone and would cut a `$$ … $$` body in half. Both
--       splitters live in the same shared module; this is the first migration
--       file in the repo that needs the dollar-quote-aware one.
--
-- ADDITIVE ONLY: two NEW tables (crm_contacts, crm_activities), one NEW NULLABLE
-- column on the EXISTING saved_matches table, and one NEW function. Nothing is
-- dropped, renamed, defaulted or back-filled. every pre-existing row keeps
-- NULL / '' honestly:
--   * saved_matches.crm_contact_id stays NULL for every saved bid that existed
--     before this migration — the CRM link is only ever set by an explicit user
--     action, never inferred from contact_name / contact_email (the migration-046
--     rule: a signal that could not supply a value leaves NULL rather than a guess).
--   * crm_contacts / crm_activities start EMPTY. This migration writes no data rows.
--
-- WHAT THIS MIGRATION IS NOT: it grants no entitlement. crm_contacts and
-- crm_activities are read/written only through /api/crm, and the tier gate lives
-- entirely in src/lib/crm-access.server.ts (subscription_status / trial state /
-- admin) — no column here is an entitlement, a billing input, or a scoring input.
--
-- PROTOCOL: applied BY HAND by the lead (operator) — PROD-FIRST, BEFORE this
-- feature's code deploys — exactly like migrations 047/051/052/053/058. It is
-- NOT run by any test, CI job or scheduled task (DELIBERATE-ONLY guard in
-- run-059.ts). In this sandbox the DATABASE_URL in the environment IS production.
--
-- WHY src/db/schema.sql IS DELIBERATELY NOT MIRRORED BY THIS MIGRATION (unlike
-- 052/058, which were). The canonical merged schema is consumed by a SECOND
-- splitter of its own — `splitSqlStatements()` in src/db/migrate.ts (`bun run
-- db:setup`) — which understands `DO $$ … END $$` but NOT a PL/pgSQL function
-- body: it would split `CREATE OR REPLACE FUNCTION … AS $$ … $$;` on the `;`
-- characters INSIDE the body and execute the fragments. schema.sql already
-- records this rule for exactly that reason (see its state-grants block: "It is an
-- index rather than a table constraint because 044 swaps the old state-keyed
-- UNIQUE constraint for it with plain, re-runnable statements (see
-- db/migrations/sql-statements.ts for why a PL/pgSQL block is not allowed
-- there)"). Mirroring only PART of 059 — the two tables, the column and the FK —
-- would be worse than mirroring nothing: a database bootstrapped from schema.sql
-- ALONE would lack crm_create_contact() and /api/crm's create path would fail
-- with a 500 the first time a real user saved a contact. So this migration stays
-- migration-only, and the function's home is here + run-059.ts. If the owner wants
-- a full schema.sql mirror, src/db/migrate.ts must first switch to the
-- dollar-quote-aware `schemaStatements()` from db/migrations/sql-statements.ts —
-- a separate, reviewable change.
--
-- ROLLBACK (in this order, all safe: nothing else references the new objects):
--   ALTER TABLE saved_matches DROP CONSTRAINT IF EXISTS saved_matches_crm_contact_owner_fk;
--   ALTER TABLE saved_matches DROP COLUMN IF EXISTS crm_contact_id;
--   DROP FUNCTION IF EXISTS crm_create_contact(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
--   DROP TABLE IF EXISTS crm_activities;
--   DROP TABLE IF EXISTS crm_contacts;
-- (The two tables are new and empty on a freshly-migrated database; dropping them
-- discards CRM data only once a user has actually created a contact.)

CREATE TABLE IF NOT EXISTS crm_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    organization TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Composite natural key. `id` alone is already the PRIMARY KEY; this UNIQUE
    -- (user_id, id) exists so the two composite foreign keys below can reference
    -- (user_id, id) and make a cross-account link IMPOSSIBLE at the database level
    -- (a saved bid can only ever point at a contact of the same owner).
    UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS crm_contacts_owner_idx ON crm_contacts(user_id, updated_at DESC) WHERE archived_at IS NULL;
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS crm_contact_id INTEGER;
-- Composite FK (cross-account contact links) — with the idempotency guard
-- described at the top of this file. MATCH SIMPLE (the default) means a NULL
-- crm_contact_id on any pre-existing saved bid satisfies the constraint, so the
-- column can stay NULL forever for rows that never had a CRM contact.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'saved_matches_crm_contact_owner_fk'
    ) THEN
        ALTER TABLE saved_matches ADD CONSTRAINT saved_matches_crm_contact_owner_fk FOREIGN KEY (user_id, crm_contact_id) REFERENCES crm_contacts (user_id, id);
    END IF;
END $$;
CREATE TABLE IF NOT EXISTS crm_activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('note','call','meeting','email')),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Same composite key as saved_matches: an activity can only be attached to a
    -- contact of its own owner.
    FOREIGN KEY (user_id, contact_id) REFERENCES crm_contacts(user_id, id)
);
CREATE INDEX IF NOT EXISTS crm_activities_owner_contact_idx ON crm_activities(user_id, contact_id, created_at DESC);
-- Atomic per-account contact cap, enforced INSIDE the database so two concurrent
-- saves cannot both observe "99 contacts" and both insert past a 100 cap. The
-- advisory xact lock is keyed (73619, user_id) — an arbitrary fixed namespace
-- (73619) plus the owner id, so it serializes ONLY the same account's creates and
-- is released automatically at the end of the statement's transaction. The caller
-- passes the limit (ContactLimit from src/lib/crm-access.server.ts): the function
-- returns NULL when the cap is reached and the route maps that to 409.
CREATE OR REPLACE FUNCTION crm_create_contact(p_user_id INTEGER, p_limit INTEGER, p_name TEXT, p_organization TEXT, p_role TEXT, p_email TEXT, p_phone TEXT, p_notes TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_count INTEGER;
    v_id INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(73619, p_user_id);
    SELECT COUNT(*) INTO v_count FROM crm_contacts WHERE user_id = p_user_id AND archived_at IS NULL;
    IF v_count >= p_limit THEN
        RETURN NULL;
    END IF;
    INSERT INTO crm_contacts (user_id, name, organization, role, email, phone, notes)
    VALUES (p_user_id, p_name, p_organization, p_role, p_email, p_phone, p_notes)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
