// Run migration 015: add ai_summary (JSONB) + ai_summary_at (TIMESTAMPTZ) to bids.
// (Also documented in db/migrations/015_ai_summary.sql; runtime idempotent
// creation lives as a lazy ALTER in src/routes/api/bids.$id.analyze.ts.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
async function run() {
  const cols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bids' AND column_name IN ('ai_summary', 'ai_summary_at')
  `;
  const existing = new Set((cols as any[]).map((c: any) => c.column_name as string));
  if (!existing.has("ai_summary")) {
    await db`ALTER TABLE bids ADD COLUMN ai_summary JSONB`;
    console.log("Added ai_summary to bids");
  } else {
    console.log("ai_summary column already exists on bids");
  }
  if (!existing.has("ai_summary_at")) {
    await db`ALTER TABLE bids ADD COLUMN ai_summary_at TIMESTAMPTZ`;
    console.log("Added ai_summary_at to bids");
  } else {
    console.log("ai_summary_at column already exists on bids");
  }
  console.log("✅ Migration 015 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
