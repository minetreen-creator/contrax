// Run migration 015: add ai_summary cache columns + updated_at to bids.
// (Also documented in db/migrations/015_ai_summary.sql; runtime idempotent
// creation lives as a lazy ALTER in src/routes/api/bids.$id.analyze.ts.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);

// (column, add-sql) pairs — each applied idempotently only if missing.
const COLS: Array<[string, string]> = [
  ["ai_summary", "ALTER TABLE bids ADD COLUMN ai_summary JSONB"],
  ["ai_summary_at", "ALTER TABLE bids ADD COLUMN ai_summary_at TIMESTAMPTZ"],
  ["ai_summary_source_hash", "ALTER TABLE bids ADD COLUMN ai_summary_source_hash TEXT"],
  ["ai_summary_schema_version", "ALTER TABLE bids ADD COLUMN ai_summary_schema_version INT"],
  ["ai_summary_model", "ALTER TABLE bids ADD COLUMN ai_summary_model TEXT"],
  ["ai_summary_generated_from_updated_at", "ALTER TABLE bids ADD COLUMN ai_summary_generated_from_updated_at TIMESTAMPTZ"],
  ["updated_at", "ALTER TABLE bids ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()"],
];

async function run() {
  const cols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bids'
  `;
  const existing = new Set((cols as any[]).map((c: any) => c.column_name as string));
  for (const [name, addSql] of COLS) {
    if (existing.has(name)) {
      console.log(`${name} column already exists on bids`);
      continue;
    }
    await db`${db.unsafe(addSql)}`;
    console.log(`Added ${name} to bids`);
  }
  console.log("✅ Migration 015 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
