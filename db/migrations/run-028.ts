// Migration 028 — Award Autopsy + Contrax Learning. See 028_award_autopsy.sql
// for the full schema and rationale. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`CREATE TABLE IF NOT EXISTS autopsy_allowance (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    billing_period TEXT NOT NULL,
    tier TEXT NOT NULL,
    autopsies_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, billing_period)
  )`;
  await db`ALTER TABLE bid_losses ADD COLUMN IF NOT EXISTS autopsy JSONB`;
  console.log("✅ Migration 028 complete (autopsy_allowance + bid_losses.autopsy)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
