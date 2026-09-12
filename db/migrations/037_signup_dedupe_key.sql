-- Migration 037 — funnel_events.dedupe_key: server-side duplicate suppression
-- for the signup one-shot family (owner 09-12, PR #374 extension, gates a–d).
--
-- WHY: the observed duplicate (visitor 1eb173bc fired signup_submit AND
-- signup_success twice 64 ms apart) slipped past the intake's 1s SELECT-then-
-- INSERT dedupe because that check is racy (both requests pass the SELECT
-- before either INSERTs). A DB-level uniqueness rule closes the race
-- atomically. Scope: ONLY signup_exit | signup_abandon | signup_submit |
-- signup_success | signup_field_error | signup_submit_error. All other events
-- keep dedupe_key NULL, and a NULL never conflicts on the partial unique
-- index (WHERE dedupe_key IS NOT NULL) — byte-identical behavior.
--
-- The key is derived SERVER-SIDE (owner REV 5): HMAC-SHA256(server secret,
-- validatedAttemptToken \0 event_name \0 scope) where the validated token is
-- the SERVER-ISSUED signed attempt token the client attached to the request
-- body (tab-scoped sessionStorage transport, never a cookie). The token binds
-- the visitor/visit identity, so two tabs / two attempts never collide. A 64
-- ms double-fire of the SAME attempt token collides → INSERT ... ON CONFLICT
-- (dedupe_key) DO NOTHING suppresses it; a fresh token (new tab / completion
-- rotation) → new key → legitimate events never collapse. Missing/forged/
-- expired token → key NULL + dedupe_status flag → event still recorded
-- (fail-open). dedupe_status is a nullable per-row outcome flag ('applied' |
-- 'fail_open_missing' | 'fail_open_forged' | 'fail_open_expired'); NULL for
-- every non-signup event (byte-identical).
--
-- Safe: plain additive DDL, no DROP, no TRUNCATE, no LOCK, ~1k rows so both
-- statements are instant and non-blocking. Historical rows untouched (new
-- column backfills NULL; partial index only covers non-null keys; no cleanup
-- pass). Idempotent (IF NOT EXISTS) — safe to re-run, but run exactly once via
-- `bun run db/migrations/run-037.ts`.
--
-- The one-time runner uses CREATE UNIQUE INDEX CONCURRENTLY (Neon-safe online
-- build for a populated table, executed outside a transaction — each neon
-- statement is its own implicit transaction). The runtime DDL guard in
-- src/lib/tracking-intake.ts (ensureFunnelEventsTable) mirrors this with the
-- plain IF NOT EXISTS form so fresh environments self-heal.
--
-- Mirrored (guarded) in src/db/schema.sql (canonical merged schema, applied by
-- `bun run src/db/setup.ts`).
--
ALTER TABLE funnel_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE funnel_events
  ADD COLUMN IF NOT EXISTS dedupe_status text;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_funnel_events_dedupe_key
  ON funnel_events (dedupe_key) WHERE dedupe_key IS NOT NULL;