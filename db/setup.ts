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

  console.log("\n✅ All migrations complete");
}

setup()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Setup failed:", e);
    process.exit(1);
  });
