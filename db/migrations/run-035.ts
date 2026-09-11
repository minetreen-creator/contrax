// Migration 035 — Bid Scout subscriptions table + indexes. See
// 035_bid_scout_subscriptions.sql for the full schema + rationale. Idempotent
// — safe to re-run; mirrors src/db/schema.sql (applied by `bun run
// src/db/setup.ts`). The checkout route also self-heals the table at runtime.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`
    CREATE TABLE IF NOT EXISTS bid_scout_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id),
        email TEXT NOT NULL,
        company_name TEXT NOT NULL,
        website TEXT,
        capabilities TEXT NOT NULL,
        naics_codes TEXT,
        certifications TEXT,
        target_states TEXT,
        notes TEXT,
        source TEXT NOT NULL DEFAULT 'bid_scout_page',
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
        stripe_checkout_session_id TEXT UNIQUE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_email
        ON bid_scout_subscriptions (LOWER(email))
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_status
        ON bid_scout_subscriptions (status)
  `;
  await db`
    CREATE INDEX IF NOT EXISTS idx_bid_scout_subscriptions_user_id
        ON bid_scout_subscriptions (user_id)
  `;
  console.log("✅ Migration 035 complete (bid_scout_subscriptions + 3 indexes)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });