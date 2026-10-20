/**
 * Storage for the daily money-path check (see path-checks.ts): one row per
 * check per run in `path_checks`, and the latest run for /admin.
 */
import { sql } from "~/db";
import type { PathCheckResult } from "~/lib/path-checks";

async function ensureTable(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS path_checks (
    id SERIAL PRIMARY KEY,
    run_at TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    status INT,
    ms INT,
    detail TEXT
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS path_checks_run_at_idx ON path_checks (run_at DESC)`;
}

export async function saveRun(runAt: string, results: PathCheckResult[]): Promise<void> {
  await ensureTable();
  for (const r of results) {
    await sql()`INSERT INTO path_checks (run_at, name, path, ok, status, ms, detail)
      VALUES (${runAt}, ${r.name}, ${r.path}, ${r.ok}, ${r.status}, ${r.ms}, ${r.detail})`;
  }
  // Keep 90 days.
  await sql()`DELETE FROM path_checks WHERE run_at < NOW() - INTERVAL '90 days'`;
}

export interface LatestRun {
  runAt: string | null;
  results: PathCheckResult[];
}

export async function latestRun(): Promise<LatestRun> {
  try {
    const rows = (await sql()`
      SELECT run_at, name, path, ok, status, ms, detail FROM path_checks
      WHERE run_at = (SELECT MAX(run_at) FROM path_checks)
      ORDER BY id
    `) as { run_at: Date | string; name: string; path: string; ok: boolean; status: number | null; ms: number | null; detail: string | null }[];
    if (!rows.length) return { runAt: null, results: [] };
    const runAt = rows[0].run_at instanceof Date ? rows[0].run_at.toISOString() : String(rows[0].run_at);
    return {
      runAt,
      results: rows.map((r) => ({ name: r.name, path: r.path, ok: r.ok, status: r.status, ms: r.ms, detail: r.detail })),
    };
  } catch {
    // No table yet = never run.
    return { runAt: null, results: [] };
  }
}
