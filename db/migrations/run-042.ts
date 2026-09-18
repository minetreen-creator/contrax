/**
 * Migration 042 — users.subscription_current_period_end (plan-tier lifecycle
 * hardening, owner order 2026-09-18). ADDITIVE + IDEMPOTENT: adds one nullable
 * column to `users`, touches no row, and is safe to re-run any number of times.
 *
 * Run with DATABASE_URL set:
 *   bun run db/migrations/run-042.ts
 *
 * WHY: the three paid ladder tiers (Starter/Professional/Agency) store their
 * subscription state on the `users` row, and `current_period_end` was the one
 * field with nowhere to live. The verified Stripe webhook
 * (handleStripeWebhook → handleTierSubscriptionEvent,
 * src/lib/tier-subscription.server.ts) is the ONLY writer; it stores an ISO
 * timestamp and leaves the column NULL when Stripe reports no period end (never
 * guessed). Conventions mirror the product-line tables
 * (grants_subscriptions / bid_scout_subscriptions).
 *
 * Mirrored in src/db/schema.sql (canonical merged schema) and in
 * db/migrations/042_tier_subscription_period_end.sql (the record).
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[run-042] DATABASE_URL is not set");
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
  "users.subscription_current_period_end",
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ`,
);

console.log("[run-042] complete");
