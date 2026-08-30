// Migration 018 — radar_saves table (anonymous Contract Radar email opt-in).
// See 018_radar_saves.sql for the full schema. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";

async function run() {
  const db = neon(process.env.DATABASE_URL!);
  await db`
    CREATE TABLE IF NOT EXISTS radar_saves (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      trade TEXT,
      state TEXT,
      cert TEXT,
      size_pref TEXT,
      phone TEXT,
      visitor_id TEXT,
      visit_id TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      matched_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (email)
    )
  `;
  // If the table pre-existed without them, ensure the unique + query indexes.
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS radar_saves_email_key ON radar_saves (email)
  `;
  await db`
    CREATE INDEX IF NOT EXISTS radar_saves_created_at_idx ON radar_saves (created_at)
  `;
  await db`
    CREATE INDEX IF NOT EXISTS radar_saves_cert_idx ON radar_saves (cert)
  `;
  await db`
    CREATE INDEX IF NOT EXISTS radar_saves_source_idx ON radar_saves (source)
  `;
  console.log("✅ Migration 018 complete (radar_saves)");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
