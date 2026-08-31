// Migration 025 — Jarvis Autonomous Upgrade Phase 5: SCHEDULED SUPERVISED WORKER.
// See db/migrations/025_jarvis_worker.sql for the canonical schema.
// This runner executes every DDL statement ONE AT A TIME (the Neon HTTP driver
// rejects multi-statement batches), each idempotent via IF NOT EXISTS / ADD
// COLUMN IF NOT EXISTS, so the migration is safe to re-run on any environment.
import { neon } from "@neondatabase/serverless";
const STATEMENTS: string[] = [
  // ── jarvis_runs — additive audit-log columns ──
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS trigger_kind TEXT`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS readers JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS note TEXT`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS refused BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS refused_reason TEXT`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS hypotheses INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS records_modified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS safe_actions JSONB NOT NULL DEFAULT '[]'::jsonb`,
  // ── owner_status — Away Mode + kill switch ──
  `ALTER TABLE owner_status ADD COLUMN IF NOT EXISTS kill_switch BOOLEAN NOT NULL DEFAULT FALSE`,
];
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  for (const stmt of STATEMENTS) {
    await db`${db.unsafe(stmt)}`;
  }
  console.log(`✅ Migration 025 complete (${STATEMENTS.length} DDL statements, Jarvis scheduled-worker audit + Away Mode + kill switch)`);
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration 025 failed:", e);
    process.exit(1);
  });
