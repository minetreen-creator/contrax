import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  // Additive + nullable; ~1k rows → instant, non-blocking. Re-runnable.
  await db`
    ALTER TABLE funnel_events
      ADD COLUMN IF NOT EXISTS dedupe_key text
  `;
  // Neon-safe online build for a populated table, executed OUTSIDE a
  // transaction (each neon() call is its own implicit transaction), per owner
  // REV 4 ("any index on an existing populated table must use CREATE UNIQUE
  // INDEX CONCURRENTLY"). The runtime DDL guard in tracking-intake.ts mirrors
  // this with the plain IF NOT EXISTS form for fresh environments.
  await db`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_funnel_events_dedupe_key
      ON funnel_events (dedupe_key) WHERE dedupe_key IS NOT NULL
  `;
  console.log(
    "✅ Migration 037 complete (funnel_events.dedupe_key + partial unique index)",
  );
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });