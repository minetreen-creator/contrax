-- Migration 022 — visitors summary badge flags.
-- Visitor Journeys fast read-path (PR #2xx). The /admin/journeys board now reads
-- each per-visitor row summary from the `visitors` cache table instead of
-- aggregating funnel_events + page_views on every load. To keep the
-- behavioral-intent badges (💰 Pricing Evaluator / 📑 Brief Viewer) without
-- touching the detail tables on the common path, the two path-related flags are
-- stored on the summary row at intake (mirroring how radar/activated are
-- maintained). saw_pricing = ever visited /pricing; saw_brief = ever visited
-- /example-brief. The 🔥 High Engagement badge derives from steps > 2 (already
-- stored).
--
-- Idempotent (ALTER ... IF NOT EXISTS), same convention as 013–021. The runtime
-- lazy guard lives in src/lib/tracking-intake.ts (ensureVisitorsTable) and is
-- duplicated in src/lib/identity-backfill.ts's CREATE, so new deploys never
-- depend on this migration having been run manually. The authoritative runtime
-- schema (run by src/db/migrate.ts) is src/db/schema.sql — updated in step.
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_pricing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_brief BOOLEAN NOT NULL DEFAULT FALSE;
