// Run migration 008: create webhooks + webhook_deliveries tables
// (Also documented in db/migrations/008_webhooks.sql; runtime idempotent
// creation lives in src/lib/webhooks.ts ensureWebhooksTable().)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
async function run() {
  const tables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('webhooks', 'webhook_deliveries')
    AND table_schema = 'public'
  `;
  const existing = new Set((tables as any[]).map((t: any) => t.table_name));
  console.log("Existing webhook tables:", [...existing]);
  if (!existing.has("webhooks")) {
    await db`
      CREATE TABLE webhooks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events JSONB NOT NULL DEFAULT '["bid_match"]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("Created webhooks");
  }
  if (!existing.has("webhook_deliveries")) {
    await db`
      CREATE TABLE webhook_deliveries (
        id SERIAL PRIMARY KEY,
        webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        payload JSONB NOT NULL,
        status_code INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1,
        success BOOLEAN NOT NULL DEFAULT false,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    console.log("Created webhook_deliveries");
  }
  await db`
    CREATE INDEX IF NOT EXISTS webhooks_user_id_idx ON webhooks (user_id)
  `;
  await db`
    CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_id_idx ON webhook_deliveries (webhook_id, created_at DESC)
  `;
  console.log("✅ Migration 008 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
