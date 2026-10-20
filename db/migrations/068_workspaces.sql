-- Migration 068 — CLIENT WORKSPACES (Agency tier phase 1, owner decision 2026-10-20;
-- see shared/agency-tier-recommendation-2026-10-20.md and business-plan rev 369).
--
-- WHAT IT IS. The $199 Agency plan's differentiator: one login, many CLIENT
-- WORKSPACES. A workspace is a named client bucket owned by one account. Its
-- states + trades live in the business_profiles row it points at (profile_id),
-- which is the SAME row the Radar / dashboard feed already reads through
-- `users.active_profile_id` — so a workspace's matches need no new match engine,
-- and switching workspaces is switching `users.active_profile_id`.
--
-- ALIGNMENT WITH WHAT ALREADY EXISTED (deliberate — no parallel concept invented):
--   * src/routes/workspace.tsx already let an Agency account create "entities"
--     (extra business_profiles rows) and switch between them through
--     users.active_profile_id. Those entities had NO cap and NO data scoping.
--   * This migration promotes that existing entity concept into a first-class,
--     capped workspace: one workspace row per business profile, backfilled from
--     the profiles that already exist, so nothing a user already created changes
--     name or disappears.
--   * src/lib/pipeline-workspace.server.ts is UNRELATED: it is the saved-bid
--     editor ("the bid workspace"), not a multi-client container. It is not touched.
--
-- ADDITIVE ONLY. Three shapes are added and NO existing table is rewritten:
--   1. NEW table workspaces;
--   2. NEW nullable columns saved_matches.workspace_id and crm_contacts.workspace_id;
--   3. NEW function workspace_create(...) — the atomic, capped create.
-- Every pre-existing saved bid and CRM contact keeps workspace_id NULL. NULL means
-- "the account's own context, not filed under a client", and the read path treats
-- it as unscoped — which is exactly how every Starter/Professional account behaves
-- today (they can never have a workspace, so their reads never filter).
--
-- BACKFILL (the ONLY data written here): one workspace row per EXISTING
-- business_profiles row, named after that profile. It is idempotent (NOT EXISTS on
-- profile_id) and it creates no profile: the profiles already exist. A profile
-- whose business_name is empty or longer than 80 characters is SKIPPED rather than
-- renamed — the name CHECK is never satisfied by inventing a name.
--
-- IDEMPOTENT BY CONSTRUCTION: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS, a pg_constraint guard around each FK (the migration-059 pattern), the
-- backfill's NOT EXISTS, and CREATE OR REPLACE FUNCTION.
--
-- SPLITTER: this file contains `DO $$ … $$` blocks and a PL/pgSQL function body,
-- so run-068.ts splits it with `schemaStatements()` (dollar-quote aware) from
-- db/migrations/sql-statements.ts — NOT `migrationStatements()`, which splits on
-- `;` alone and would cut a function body in half. Same rule as 059/060.
--
-- WHY src/db/schema.sql IS NOT MIRRORED (the migration-059 rule, unchanged):
-- schema.sql is consumed by a second splitter (src/db/migrate.ts) that cannot parse
-- a PL/pgSQL body, so mirroring only PART of this migration would give a
-- schema.sql-bootstrapped database the tables but not workspace_create(), and the
-- Agency create path would 500. The reviewed record is this file + run-068.ts.
--
-- PROTOCOL: applied BY HAND by the operator/lead, PROD-FIRST, BEFORE this feature's
-- code deploys (the 047/051/052/053/058/059/060/062/063/064 protocol). Never run by
-- a test, a CI job or a scheduled task (DELIBERATE-ONLY guard in run-068.ts). In
-- this sandbox the DATABASE_URL in the environment IS production.
--
-- ROLLBACK (in this order; every step is safe and loses no user-authored data):
--   ALTER TABLE saved_matches DROP CONSTRAINT IF EXISTS saved_matches_workspace_fk;
--   ALTER TABLE crm_contacts  DROP CONSTRAINT IF EXISTS crm_contacts_workspace_fk;
--   DROP INDEX IF EXISTS saved_matches_workspace_idx;
--   DROP INDEX IF EXISTS crm_contacts_workspace_idx;
--   ALTER TABLE crm_contacts  DROP COLUMN IF EXISTS workspace_id;
--   ALTER TABLE saved_matches DROP COLUMN IF EXISTS workspace_id;
--   DROP FUNCTION IF EXISTS workspace_create(INTEGER, INTEGER, TEXT, JSONB, JSONB);
--   DROP TABLE IF EXISTS workspaces;
-- (Dropping the table discards only the workspace NAMES/links — the client
-- business_profiles rows, saved bids and CRM contacts all survive intact.)
CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    -- The owning account. ON DELETE CASCADE: a deleted user takes their workspaces
    -- with them (same rule as crm_contacts in migration 059).
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The client's display name. Bounded exactly like business_profiles names.
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    -- The business_profiles row that carries this workspace's states (locations),
    -- trades (service_categories) and NAICS codes. ONE workspace per profile, and
    -- ON DELETE CASCADE: deleting the client's entity row removes the workspace.
    profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id),
    -- Composite key so /api/workspaces can resolve "a workspace this account owns"
    -- in one indexed lookup (`WHERE user_id = … AND id = …`).
    UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (user_id, created_at);
-- BACKFILL: existing entities become workspaces, one per profile, named as they
-- already are. Idempotent (NOT EXISTS on profile_id); no profile is created,
-- renamed or deleted. A blank/over-long name is skipped, never invented.
INSERT INTO workspaces (user_id, name, profile_id, created_at, updated_at)
SELECT bp.user_id,
       btrim(bp.business_name),
       bp.id,
       COALESCE(bp.created_at, NOW()),
       COALESCE(bp.updated_at, COALESCE(bp.created_at, NOW()))
FROM business_profiles bp
WHERE bp.user_id IS NOT NULL
  AND length(btrim(COALESCE(bp.business_name, ''))) BETWEEN 1 AND 80
  AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.profile_id = bp.id);
-- The two scoped user-data surfaces. NULL = not filed under a client (see header).
ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS workspace_id INTEGER;
ALTER TABLE crm_contacts  ADD COLUMN IF NOT EXISTS workspace_id INTEGER;
-- FK on the workspace id. ON DELETE SET NULL is the deliberate choice: deleting a
-- client workspace must NEVER delete that client's saved bids or contacts — they
-- fall back to the account's own unscoped context, which is the same
-- "reads survive, data preserved" rule the CRM uses on a downgrade.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_matches_workspace_fk') THEN
        ALTER TABLE saved_matches ADD CONSTRAINT saved_matches_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_workspace_fk') THEN
        ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_workspace_fk
            FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE SET NULL;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS saved_matches_workspace_idx
    ON saved_matches (user_id, workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_workspace_idx
    ON crm_contacts (user_id, workspace_id) WHERE workspace_id IS NOT NULL;
-- Atomic capped create — the migration-059 pattern (crm_create_contact), because a
-- read-then-insert in the route could let two concurrent creates both observe "9
-- workspaces" and both insert past the cap of 10. The advisory xact lock namespace
-- is 73620 (73619 is the CRM contact cap's), keyed by the owner, and it is released
-- automatically at the end of the statement's transaction. p_limit is passed by the
-- caller (WORKSPACE_LIMIT in src/lib/workspaces.ts) so the cap lives in ONE place in
-- code as well as being enforced inside the database; the function returns NULL when
-- the cap is reached and the route maps that to 409.
-- It creates BOTH rows in one transaction: the client's business_profiles row
-- (states → locations, trades → service_categories) and the workspace that points
-- at it. A failure anywhere leaves neither behind.
CREATE OR REPLACE FUNCTION workspace_create(
    p_user_id INTEGER,
    p_limit INTEGER,
    p_name TEXT,
    p_states JSONB,
    p_trades JSONB
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_count INTEGER;
    v_profile_id INTEGER;
    v_id INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(73620, p_user_id);
    SELECT COUNT(*) INTO v_count FROM workspaces WHERE user_id = p_user_id;
    IF v_count >= p_limit THEN
        RETURN NULL;
    END IF;
    INSERT INTO business_profiles (user_id, business_name, industry, locations, service_categories, naics_codes, is_agency)
    VALUES (p_user_id, btrim(p_name), 'General',
            COALESCE(p_states, '[]'::jsonb), COALESCE(p_trades, '[]'::jsonb), '[]'::jsonb, TRUE)
    RETURNING id INTO v_profile_id;
    INSERT INTO workspaces (user_id, name, profile_id)
    VALUES (p_user_id, btrim(p_name), v_profile_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
