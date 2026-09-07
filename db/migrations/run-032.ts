// Migration 032 — radar match-alert dedupe columns + sent-log. See
// 032_radar_leads_alerts.sql for the full schema + rationale. Idempotent —
// safe to re-run; the sender module also self-heals these at runtime.
import { neon } from "@neondatabase/serverless";

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS sent_bid_ids JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await db`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ`;
  await db`
    CREATE TABLE IF NOT EXISTS radar_leads_alerts_sent (
      lead_id BIGINT NOT NULL REFERENCES radar_leads(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (lead_id, bid_id)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS radar_leads_alerts_sent_lead_idx ON radar_leads_alerts_sent (lead_id)`;
  console.log("✅ Migration 032 complete (radar_leads alert dedupe + sent-log)");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });