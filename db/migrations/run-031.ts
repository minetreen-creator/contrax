// Migration 031 — radar_leads opt-in email capture. See 031_radar_leads.sql
// for the full schema + rationale. Idempotent — safe to re-run; the capture
// route also self-heals the table at runtime (same pattern as every guard).
import { neon } from "@neondatabase/serverless";

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`
    CREATE TABLE IF NOT EXISTS radar_leads (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      visitor_id TEXT,
      radar_profile JSONB,
      source TEXT NOT NULL DEFAULT 'radar',
      consent BOOLEAN NOT NULL DEFAULT TRUE,
      confirmed_at TIMESTAMPTZ,
      unsubscribed_at TIMESTAMPTZ,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_radar_leads_confirmed
      ON radar_leads (confirmed_at)
      WHERE confirmed_at IS NOT NULL
  `;
  console.log("✅ Migration 031 complete (radar_leads)");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });