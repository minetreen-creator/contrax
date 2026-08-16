// Run migration 010: add citations column to proposal_drafts
// (Also documented in db/migrations/010_proposal_drafts_citations.sql;
// runtime idempotent creation lives as a lazy ALTER in
// src/routes/api/bids-draft.ts and friends.)
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
async function run() {
  const cols = await db`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'proposal_drafts' AND column_name = 'citations'
  `;
  if (cols.length === 0) {
    await db`ALTER TABLE proposal_drafts ADD COLUMN citations JSONB DEFAULT '[]'::jsonb`;
    console.log("Added citations to proposal_drafts");
  } else {
    console.log("citations column already exists on proposal_drafts");
  }
  console.log("✅ Migration 010 complete");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
