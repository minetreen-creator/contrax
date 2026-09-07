// Migration 033 — Radar match-alert CTA click logging. See
// 033_radar_leads_clicks.sql for the full schema + rationale. Idempotent —
// safe to re-run; the redirect route + sender also self-heal these at runtime.
// NOTE: distinct table name `radar_lead_opportunity_clicks` — migration 019
// owns `radar_alerts_sent` and migration 032 owns `radar_leads_alerts_sent`;
// reusing either would silently no-op CREATE TABLE and crash the INSERT/index.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ`;
  await db`
    CREATE TABLE IF NOT EXISTS radar_lead_opportunity_clicks (
      lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      token_hash TEXT,
      PRIMARY KEY (lead_id, bid_id)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS radar_lead_opportunity_clicks_lead_idx ON radar_lead_opportunity_clicks (lead_id)`;
  console.log("✅ Migration 033 complete (radar_leads click counters + click log)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });