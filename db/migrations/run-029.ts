// Migration 029 — bid_losses full modern schema. See 029_bid_losses_columns.sql
// for the full schema and rationale. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`CREATE TABLE IF NOT EXISTS bid_losses (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    agency TEXT NOT NULL,
    estimated_value TEXT,
    awarded_to TEXT,
    debrief_notes TEXT,
    naics_code TEXT,
    weaknesses JSONB DEFAULT '[]'::jsonb,
    primary_reason TEXT,
    severity TEXT,
    actionable_fix TEXT,
    recurring_count INTEGER DEFAULT 0,
    autopsy JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS estimated_value TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS awarded_to TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS debrief_notes TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS naics_code TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS weaknesses JSONB DEFAULT '[]'::jsonb`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS primary_reason TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS severity TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS actionable_fix TEXT`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS recurring_count INTEGER DEFAULT 0`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS autopsy JSONB`;
  console.log("✅ Migration 029 complete (bid_losses full modern schema)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });