// Migration 019 — radar alerts infrastructure (unsubscribe, last-alert
// watermark, crash-safe sent-log). See 019_radar_alerts.sql for the full
// schema. Idempotent — safe to re-run on any environment.
import { neon } from "@neondatabase/serverless";

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT false`;
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`;
  await db`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ`;
  await db`
    CREATE TABLE IF NOT EXISTS radar_alerts_sent (
      radar_save_id BIGINT NOT NULL REFERENCES radar_saves(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (radar_save_id, bid_id)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS radar_alerts_sent_save_idx ON radar_alerts_sent (radar_save_id)`;
  await db`CREATE INDEX IF NOT EXISTS radar_saves_unsubscribed_idx ON radar_saves (unsubscribed)`;
  console.log("✅ Migration 019 complete (radar alerts)");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
