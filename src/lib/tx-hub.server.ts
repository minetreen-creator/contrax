/** Storage and lookups for Texas HUB-certified firms (src/lib/tx-hub.ts). */
import { sql } from "~/db";
import type { TxHubFirm } from "~/lib/tx-hub";

export async function ensureTxHubTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS tx_hub_firms (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      county TEXT,
      description TEXT,
      trades TEXT[] NOT NULL DEFAULT '{}',
      expires DATE,
      synced_on DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql()`CREATE INDEX IF NOT EXISTS tx_hub_firms_trades_idx ON tx_hub_firms USING GIN (trades)`;
}

export async function upsertTxHubFirms(rows: TxHubFirm[], syncedOn: string): Promise<void> {
  rows = [...new Map(rows.map((r) => [r.key, r])).values()];
  if (!rows.length) return;
  await sql()`
    INSERT INTO tx_hub_firms (key, name, city, county, description, trades, expires, synced_on, updated_at)
    SELECT x.key, x.name, x.city, x.county, x.description, x.trades, x.expires::date, ${syncedOn}::date, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS x(key TEXT, name TEXT, city TEXT, county TEXT, description TEXT, trades TEXT[], expires TEXT)
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name, city = EXCLUDED.city, county = EXCLUDED.county, description = EXCLUDED.description,
      trades = EXCLUDED.trades, expires = EXCLUDED.expires, synced_on = EXCLUDED.synced_on, updated_at = NOW()
  `;
}

/** Firms no longer active HUBs drop out after a full, plausible sync. */
export async function pruneTxHubFirms(syncedOn: string): Promise<number> {
  return ((await sql()`DELETE FROM tx_hub_firms WHERE synced_on < ${syncedOn}::date RETURNING key`) as unknown[]).length;
}

export async function txHubCount(): Promise<number> {
  return Number(((await sql()`SELECT COUNT(*)::int AS n FROM tx_hub_firms`) as { n: number }[])[0]?.n ?? 0);
}

export interface TxHubRow {
  key: string;
  name: string;
  city: string | null;
  description: string | null;
}

/** HUB firms for a trade, optionally in some cities (lower-cased compare). Empty when the table isn't there yet. */
export async function txHubFirms(q: { trade: string | null; cities?: readonly string[]; limit: number }): Promise<{ total: number; rows: TxHubRow[] }> {
  try {
    const s = sql();
    const tradePred = q.trade ? s`AND ${q.trade} = ANY(trades)` : s``;
    const cityPred = q.cities?.length ? s`AND LOWER(city) = ANY(${q.cities.map((c) => c.toLowerCase())})` : s``;
    const [count, rows] = await Promise.all([
      s`SELECT COUNT(*)::int AS n FROM tx_hub_firms WHERE TRUE ${tradePred} ${cityPred}`,
      s`SELECT key, name, city, description FROM tx_hub_firms WHERE TRUE ${tradePred} ${cityPred} ORDER BY name ASC LIMIT ${q.limit}`,
    ]);
    return { total: Number((count as { n: number }[])[0]?.n ?? 0), rows: rows as TxHubRow[] };
  } catch {
    return { total: 0, rows: [] };
  }
}

/** How many HUB firms do any of these trades in these cities (lower-cased compare). 0 when the table isn't there yet. */
export async function txHubCountIn(q: { cities: readonly string[]; trades: readonly string[] }): Promise<number> {
  if (!q.cities.length || !q.trades.length) return 0;
  try {
    const rows = (await sql()`
      SELECT COUNT(*)::int AS n FROM tx_hub_firms
      WHERE LOWER(city) = ANY(${q.cities.map((c) => c.toLowerCase())}) AND trades && ${[...q.trades]}::text[]
    `) as { n: number }[];
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
