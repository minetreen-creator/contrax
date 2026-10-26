import { sql } from "~/db";

/** The scraper tracker's list (src/lib/scraper-watch.ts). Idempotent, safe per request. */
export async function ensureTrackedVisitorsTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS tracked_visitors (
    visitor_id TEXT PRIMARY KEY,
    tracked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT
  )`;
}
