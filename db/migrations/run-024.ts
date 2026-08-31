// Migration 024 — Jarvis Autonomous Upgrade Phase 4: OWNER-APPROVAL QUEUE.
// See db/migrations/024_jarvis_actions.sql for the canonical schema.
// This runner executes every DDL statement ONE AT A TIME (the Neon HTTP driver
// rejects multi-statement batches), each idempotent via IF NOT EXISTS, so the
// migration is safe to re-run on any environment.
import { neon } from "@neondatabase/serverless";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS jarvis_actions (
    id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    resource TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    authority_level TEXT NOT NULL DEFAULT 'L4' CHECK (authority_level IN ('L0','L1','L2','L3','L4','L5')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','executed','failed','expired')),
    requested_by TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by TEXT,
    reason TEXT,
    owner_approved BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE INDEX IF NOT EXISTS jarvis_actions_status_idx ON jarvis_actions (status)`,
  `CREATE INDEX IF NOT EXISTS jarvis_actions_owner_approved_idx ON jarvis_actions (owner_approved)`,
  `CREATE INDEX IF NOT EXISTS jarvis_actions_requested_at_idx ON jarvis_actions (requested_at)`,
  `CREATE INDEX IF NOT EXISTS jarvis_actions_action_type_idx ON jarvis_actions (action_type)`,
];

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  for (const stmt of STATEMENTS) {
    await db`${db.unsafe(stmt)}`;
  }
  console.log(`✅ Migration 024 complete (${STATEMENTS.length} DDL statements, Jarvis authority queue)`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration 024 failed:", e);
    process.exit(1);
  });
