// Run migration 002: add Stripe columns to users table
import { neon } from "@neondatabase/serverless";

const db = neon(process.env.DATABASE_URL!);

async function run() {
  // Check existing columns
  const cols = await db`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='users' AND column_name IN ('stripe_customer_id', 'subscription_status', 'plan_tier')
  `;
  const existing = new Set(cols.map((c: any) => c.column_name));
  console.log("Existing stripe columns:", [...existing]);

  if (!existing.has("stripe_customer_id")) {
    await db`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`;
    console.log("Added stripe_customer_id");
  }
  if (!existing.has("subscription_status")) {
    await db`ALTER TABLE users ADD COLUMN subscription_status TEXT`;
    console.log("Added subscription_status");
  }
  if (!existing.has("plan_tier")) {
    await db`ALTER TABLE users ADD COLUMN plan_tier TEXT`;
    console.log("Added plan_tier");
  }
  console.log("✅ Migration 002 complete");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
