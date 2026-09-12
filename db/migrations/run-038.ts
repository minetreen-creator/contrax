import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  // Additive + nullable; ~1k rows → instant, non-blocking. Re-runnable.
  await db`
    ALTER TABLE funnel_events
      ADD COLUMN IF NOT EXISTS dedupe_status text
  `;
  console.log("✅ Migration 038 complete (funnel_events.dedupe_status)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });