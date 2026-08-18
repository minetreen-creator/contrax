// Run migration 011: create pending_drafts table
// (Also documented in db/migrations/011_pending_drafts.sql; runtime idempotent
// creation lives as lazy CREATEs in src/routes/api/pending-drafts.ts and
// src/routes/api/pending-drafts/fulfill.ts.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
async function run() {
  const tables = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'pending_drafts' AND table_schema = 'public'
  `;
  if ((tables as any[]).length === 0) {
    await db`
      CREATE TABLE pending_drafts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        solicitation_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_profile',
        draft_text TEXT,
        citations JSONB DEFAULT '[]'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ
      )
    `;
    console.log("Created pending_drafts");
  } else {
    console.log("pending_drafts table already exists");
  }
  await db`
    CREATE INDEX IF NOT EXISTS idx_pending_drafts_user_status ON pending_drafts (user_id, status)
  `;
  console.log("✅ Migration 011 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
