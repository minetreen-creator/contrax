-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 — Signup funnel release: COMPANY NAME on the account.
--
-- Owner directive (signup-funnel release): collect an OPTIONAL company name at
-- signup and store it on the account (users.company_name). Purely additive:
-- one nullable TEXT column, no existing column/table/constraint changed.
--
-- Conventions follow migrations 023-025: idempotent DDL (ADD COLUMN IF NOT
-- EXISTS), safe to re-run on any environment. Nullable, so existing signups
-- and signups that skip the field stay NULL (no default needed).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;