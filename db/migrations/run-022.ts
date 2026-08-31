// Migration 022 — visitors summary badge flags. See 022_visitors_badges.sql.
// Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_pricing BOOLEAN NOT NULL DEFAULT FALSE`;
  await db`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS saw_brief BOOLEAN NOT NULL DEFAULT FALSE`;
  console.log("✅ Migration 022 complete (visitors badge flags)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
