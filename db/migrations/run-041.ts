/**
 * Migration 041 — grants_subscriptions (Contrax Grants $19/month, owner
 * 2026-09-17). ADDITIVE + IDEMPOTENT: creates the table + indexes only, never
 * touches an existing table, and is safe to re-run any number of times.
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-041.ts
 *
 * The table stores one row per Stripe subscription for the Grants product and is
 * the ONLY source of grant entitlement (written by verified Stripe webhooks).
 * Conventions mirror bid_scout_subscriptions (run-035).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-041] DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);

async function run(label: string, q: string) {
  try {
    await sql`${sql.unsafe(q)}`;
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label} :: ${(e as Error).message.slice(0, 300)}`);
    process.exitCode = 1;
  }
}

await run(
  "grants_subscriptions table",
  `
  CREATE TABLE IF NOT EXISTS grants_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER REFERENCES users(id),
      email TEXT,
      status TEXT NOT NULL DEFAULT 'incomplete'
          CHECK (status IN (
              'incomplete', 'incomplete_expired', 'trialing', 'active',
              'past_due', 'canceled', 'unpaid', 'paused'
          )),
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      stripe_checkout_session_id TEXT UNIQUE,
      price_id TEXT,
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
  `,
);

await run(
  "grants_subscriptions user index",
  `CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_user_id
       ON grants_subscriptions (user_id)`,
);
await run(
  "grants_subscriptions customer index",
  `CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_customer_id
       ON grants_subscriptions (stripe_customer_id)`,
);
await run(
  "grants_subscriptions status index",
  `CREATE INDEX IF NOT EXISTS idx_grants_subscriptions_status
       ON grants_subscriptions (status)`,
);

console.log("[run-041] complete");
