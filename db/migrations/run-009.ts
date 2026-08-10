// Run migration 009: create slack_config + slack_deliveries tables
// (Also documented in db/migrations/009_slack.sql; runtime idempotent
// creation lives in src/lib/slack.ts ensureSlackTables().)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
async function run() {
  const tables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('slack_config', 'slack_deliveries')
    AND table_schema = 'public'
  `;
  const existing = new Set((tables as any[]).map((t: any) => t.table_name));
  console.log("Existing slack tables:", [...existing]);
  if (!existing.has("slack_config")) {
    await db`
      CREATE TABLE slack_config (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        webhook_url TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("Created slack_config");
  }
  if (!existing.has("slack_deliveries")) {
    await db`
      CREATE TABLE slack_deliveries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        event TEXT NOT NULL,
        status_code INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1,
        success BOOLEAN NOT NULL DEFAULT false,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("Created slack_deliveries");
  }
  await db`
    CREATE INDEX IF NOT EXISTS slack_deliveries_user_id_idx ON slack_deliveries (user_id, created_at DESC)
  `;
  console.log("✅ Migration 009 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
