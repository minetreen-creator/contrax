// Migration 027 — watched_visitors + per-visitor page_views index. See
// 027_watched_visitors.sql for the full schema. Idempotent — safe to re-run.
import { neon } from "@neondatabase/serverless";
async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);
  await db`CREATE TABLE IF NOT EXISTS watched_visitors (
    visitor_id TEXT PRIMARY KEY,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_viewed_at TIMESTAMPTZ,
    note TEXT
  )`;
  await db`CREATE INDEX IF NOT EXISTS idx_page_views_visitor_id ON page_views (visitor_id)`;
  console.log("✅ Migration 027 complete (watched_visitors + page_views(visitor_id) index)");
}
run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Migration failed:", e);
    process.exit(1);
  });
