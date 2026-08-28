// Master setup: runs all migrations in order
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = neon(DATABASE_URL);

async function setup() {
  console.log("Starting database setup...\n");

  // 001: users
  console.log("--- Migration 001: users ---");
  const tables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'users' AND table_schema = 'public'
  `;
  if (tables.length === 0) {
    await db`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Created users table");
  } else {
    console.log("users table already exists");
  }

  // 002: Stripe columns
  console.log("\n--- Migration 002: Stripe columns ---");
  const cols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='users' AND column_name IN ('stripe_customer_id', 'subscription_status', 'plan_tier')
  `;
  const existing = new Set((cols as any[]).map((c: any) => c.column_name));
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

  // 003: waitlist
  console.log("\n--- Migration 003: waitlist ---");
  const wl = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'waitlist' AND table_schema = 'public'
  `;
  if (wl.length === 0) {
    await db`
      CREATE TABLE waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        source TEXT DEFAULT 'landing_page',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Created waitlist table");
  } else {
    console.log("waitlist table already exists");
  }

  // 004: savings
  console.log("\n--- Migration 004: savings ---");
  const savingsTables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('savings_diagnoses', 'savings_bills')
    AND table_schema = 'public'
  `;
  const savingsExisting = new Set((savingsTables as any[]).map((t: any) => t.table_name));
  if (!savingsExisting.has("savings_diagnoses")) {
    await db`
      CREATE TABLE savings_diagnoses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bill_type TEXT,
        provider_name TEXT,
        current_amount DECIMAL(10,2),
        diagnosis_json JSONB,
        savings_prescription JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Created savings_diagnoses");
  }
  if (!savingsExisting.has("savings_bills")) {
    await db`
      CREATE TABLE savings_bills (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bill_type TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        current_amount DECIMAL(10,2) NOT NULL,
        billing_cycle TEXT DEFAULT 'monthly',
        next_due_date DATE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Created savings_bills");
  }

  // 005: is_admin flag for the users table
  console.log("\n--- Migration 005: is_admin ---");
  const adminCols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='users' AND column_name = 'is_admin'
  `;
  if (adminCols.length === 0) {
    await db`ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE`;
    console.log("Added is_admin to users");
  } else {
    console.log("is_admin already exists");
  }

    // 006: Stripe subscription id + trial_started_at on the users table
  console.log("\n--- Migration 006: Stripe subscription + trial columns ---");
  const stripeCols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='users' AND column_name IN ('stripe_subscription_id', 'trial_started_at')
  `;
  const stripeExisting = new Set((stripeCols as any[]).map((c: any) => c.column_name));
  if (!stripeExisting.has("stripe_subscription_id")) {
    await db`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`;
    console.log("Added stripe_subscription_id");
  }
  if (!stripeExisting.has("trial_started_at")) {
    await db`ALTER TABLE users ADD COLUMN trial_started_at TIMESTAMPTZ`;
    console.log("Added trial_started_at");
  }

  // 013: per-user time-boxed access grant. access_expires_at is a soft-expiring
  // access window for specific grant accounts (e.g. partner free trials NOT
  // backed by Stripe); full_access unlocks every premium tier while the grant
  // is still active. NULL/false for everyone else -> no behavior change.
  console.log("\n--- Migration 013: access expiry grant columns ---");
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_access BOOLEAN NOT NULL DEFAULT FALSE`;
  console.log("Added access_expires_at / full_access to users");
  // 014: admin-query + rate-limiter indexes. Forward-looking as users /
  // funnel_events / rate_limits / waitlist scale. Idempotent via IF NOT EXISTS.
  // Documented in db/migrations/014_admin_query_indexes.sql.
  console.log("\n--- Migration 014: admin-query + rate-limiter indexes ---");
  await db`CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits (window_start)`;
  await db`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at)`;
  console.log("Added idx_rate_limits_window_start / idx_users_created_at / idx_waitlist_created_at");

console.log("\n✅ All migrations complete");
}

setup()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Setup failed:", e);
    process.exit(1);
  });

  // 007: FPDS / USASpending incumbent intelligence cache
  console.log("\n--- Migration 007: fpds_lookups ---");
  await db`CREATE TABLE IF NOT EXISTS fpds_lookups (id SERIAL PRIMARY KEY, lookup_key TEXT NOT NULL UNIQUE, incumbent_name TEXT, incumbent_uei TEXT, total_obligated DECIMAL(14,2), pop_start_date TEXT, pop_end_date TEXT, historical_pricing JSONB DEFAULT '[]'::jsonb, fetched_at TIMESTAMPTZ DEFAULT NOW())`;
  console.log("fpds_lookups ready");

