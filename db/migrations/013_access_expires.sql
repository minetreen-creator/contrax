-- Migration 013: per-user time-boxed access grant.
--
-- Allows a tiny number of SPECIFIC accounts to get free, time-boxed access
-- that auto-expires — used for partner/owner free-trial grants that are NOT
-- backed by Stripe. NULL/false for every other user => NO behavior change.
--
--   access_expires_at TIMESTAMPTZ  — optional access deadline. When set it is
--                                    the single source of truth for access:
--                                    active while now < access_expires_at,
--                                    genuinely expired once now >= it. NULL = no
--                                    effect (existing trial/paid behavior).
--   full_access       BOOLEAN       — while the grant above is still active,
--                                    unlocks every premium PlanGate tier. Ignored
--                                    (and forces expired) once the date passes.
--
-- Applied as two single-statement ALTERs (the Neon serverless driver rejects
-- multi-statement batches); each is idempotent via IF NOT EXISTS. Mirrored in
-- db/setup.ts (Migration 013 block).
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT FALSE;
