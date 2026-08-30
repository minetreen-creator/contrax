// Migration 020 — radar_saves in-app fulfillment tracking. See
// 020_radar_fulfillment.sql for the full schema. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ`;
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_user_id BIGINT`;
  await db`CREATE INDEX IF NOT EXISTS radar_saves_fulfilled_at_idx ON radar_saves (email) WHERE fulfilled_at IS NULL`;
  console.log("✅ Migration 020 complete (radar_saves in-app fulfillment)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
