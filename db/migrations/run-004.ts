// Run migration 004: savings tables
import { neon } from "@neondatabase/serverless";

const db = neon(process.env.DATABASE_URL!);

async function run() {
  // Check existing columns
  const tables = await db`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name IN ('savings_diagnoses', 'savings_bills')
    AND table_schema = 'public'
  `;
  const existing = new Set((tables as any[]).map((t: any) => t.table_name));
  console.log("Existing savings tables:", [...existing]);

  if (!existing.has("savings_diagnoses")) {
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

  if (!existing.has("savings_bills")) {
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

  console.log("✅ Migration 004 complete");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
