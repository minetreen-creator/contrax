// Run migration 016: create the ai_brief_allowance ledger table.
// (Also documented in db/migrations/016_ai_brief_allowance.sql; runtime
// idempotent creation lives as a lazy CREATE TABLE IF NOT EXISTS in
// src/lib/ai-brief-allowance.ts so the feature self-heals on any environment.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ai_brief_allowance (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    billing_period TEXT NOT NULL,
    tier TEXT NOT NULL,
    briefs_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, billing_period)
  )
`;

async function run() {
  const rows = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'ai_brief_allowance'
  `;
  if ((rows as any[]).length > 0) {
    console.log("ai_brief_allowance already exists");
  } else {
    await db`${db.unsafe(CREATE_TABLE)}`;
    console.log("Created ai_brief_allowance");
  }
  // Also ensure the unique index survives if a bare table pre-existed without it.
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_brief_allowance_user_period_key
    ON ai_brief_allowance (user_id, billing_period)
  `;
  console.log("✅ Migration 016 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
