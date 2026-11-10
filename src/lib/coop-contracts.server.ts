/** Storage and reads for purchasing co-op solicitations (src/lib/coop-contracts.ts, src/jobs/coop-sync.ts). */
import { sql } from "~/db";
import type { CoopSolicitation } from "~/lib/coop-contracts";

export async function ensureCoopTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS coop_solicitations (
      key TEXT PRIMARY KEY,
      coop TEXT NOT NULL,
      number TEXT,
      title TEXT NOT NULL,
      due_at TIMESTAMPTZ,
      url TEXT NOT NULL,
      trades TEXT[] NOT NULL DEFAULT '{}',
      construction BOOLEAN NOT NULL DEFAULT FALSE,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at TIMESTAMPTZ NOT NULL
    )`;
}

/** Store one co-op's current list, then drop that co-op's rows it no longer lists. */
export async function replaceCoopSolicitations(coop: string, rows: CoopSolicitation[], syncedAt: string): Promise<{ stored: number; dropped: number }> {
  rows = [...new Map(rows.map((r) => [r.key, r])).values()];
  if (rows.length) {
    await sql()`
      INSERT INTO coop_solicitations (key, coop, number, title, due_at, url, trades, construction, synced_at)
      SELECT x.key, x.coop, x.number, x.title, x."dueAt"::timestamptz, x.url, x.trades, x.construction, ${syncedAt}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x(key TEXT, coop TEXT, number TEXT, title TEXT, "dueAt" TEXT, url TEXT, trades TEXT[], construction BOOLEAN)
      ON CONFLICT (key) DO UPDATE SET
        number = EXCLUDED.number, title = EXCLUDED.title, due_at = EXCLUDED.due_at, url = EXCLUDED.url,
        trades = EXCLUDED.trades, construction = EXCLUDED.construction, synced_at = EXCLUDED.synced_at
    `;
  }
  const dropped = (await sql()`DELETE FROM coop_solicitations WHERE coop = ${coop} AND synced_at < ${syncedAt}::timestamptz RETURNING key`) as unknown[];
  return { stored: rows.length, dropped: dropped.length };
}

/** Open (not yet due) and announced co-op solicitations, optionally for one trade. Empty when the table isn't there yet. */
export async function openCoopSolicitations(trade?: string | null): Promise<CoopSolicitation[]> {
  try {
    const s = sql();
    const tradePred = trade ? s`AND ${trade} = ANY(trades)` : s``;
    const rows = (await s`
      SELECT key, coop, number, title, due_at, url, trades, construction FROM coop_solicitations
      WHERE (due_at IS NULL OR due_at > NOW()) ${tradePred}
      ORDER BY due_at IS NULL, due_at ASC, title ASC
      LIMIT 100
    `) as { key: string; coop: CoopSolicitation["coop"]; number: string | null; title: string; due_at: string | Date | null; url: string; trades: string[]; construction: boolean }[];
    return rows.map((r) => ({
      key: r.key,
      coop: r.coop,
      number: r.number,
      title: r.title,
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
      url: r.url,
      trades: r.trades ?? [],
      construction: r.construction,
    }));
  } catch {
    return [];
  }
}
