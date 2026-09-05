// Migration 030 — free-first-autopsy gift marker on users. See
// 030_first_autopsy_gifted.sql for the full rationale. Idempotent — safe to
// re-run.
import { neon } from "@neondatabase/serverless";

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_autopsy_gifted BOOLEAN NOT NULL DEFAULT FALSE`;
  console.log("✅ Migration 030 complete (users.first_autopsy_gifted)");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });