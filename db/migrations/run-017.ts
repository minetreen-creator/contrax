// Run migration 017: create the trial_usage per-trial ledger table.
// (Also documented in db/migrations/017_trial_usage.sql; runtime idempotent
// creation lives as a lazy CREATE TABLE IF NOT EXISTS in
// src/lib/trial-usage.ts so the feature self-heals on any environment.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS trial_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    trial_started_at TIMESTAMPTZ NOT NULL,
    briefs_used INTEGER NOT NULL DEFAULT 0,
    scores_used INTEGER NOT NULL DEFAULT 0,
    drafts_used INTEGER NOT NULL DEFAULT 0,
    incumbent_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, trial_started_at)
  )
`;
async function run() {
  const rows = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'trial_usage'
  `;
  if ((rows as any[]).length > 0) {
    console.log("trial_usage already exists");
  } else {
    await db`${db.unsafe(CREATE_TABLE)}`;
    console.log("Created trial_usage");
  }
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS trial_usage_user_instance_key
    ON trial_usage (user_id, trial_started_at)
  `;
  console.log("✅ Migration 017 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration 017 failed:", e);
    process.exit(1);
  });
