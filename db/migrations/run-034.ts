// Migration 034 — Radar trade-query expansion snapshots. See
// 034_radar_trade_expansion.sql for schema + rationale. Idempotent — safe to
// re-run; the capture routes self-heal.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS trade_expanded JSONB`;
  console.log("✅ Migration 034 complete (radar_saves.trade_expanded)");
  console.log("ℹ️  radar_leads.radar_profile.expanded is a JSONB key, NOT a column — capture writes it via /api/radar/lead (COALESCE refresh).");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
