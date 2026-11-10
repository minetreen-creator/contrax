/** Storage and lookups for SAM.gov registered small businesses (src/lib/sam-registrants.ts). */
import { sql } from "~/db";
import type { SamRegistrant } from "~/lib/sam-registrants";

export async function ensureSamRegistrantsTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS sam_registrants (
      uei TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      state TEXT NOT NULL,
      zip TEXT,
      url TEXT,
      trades TEXT[] NOT NULL DEFAULT '{}',
      certs TEXT[] NOT NULL DEFAULT '{}',
      naics TEXT[] NOT NULL DEFAULT '{}',
      expires DATE,
      extract_date DATE NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql()`CREATE INDEX IF NOT EXISTS sam_registrants_state_idx ON sam_registrants (state)`;
  await sql()`CREATE INDEX IF NOT EXISTS sam_registrants_trades_idx ON sam_registrants USING GIN (trades)`;
}

/** Insert or refresh a batch from one monthly extract. */
export async function upsertSamRegistrants(rows: SamRegistrant[], extractDate: string): Promise<void> {
  // ON CONFLICT can't touch one row twice in a statement: keep the last row per UEI.
  rows = [...new Map(rows.map((r) => [r.uei, r])).values()];
  if (!rows.length) return;
  await sql()`
    INSERT INTO sam_registrants (uei, name, city, state, zip, url, trades, certs, naics, expires, extract_date, updated_at)
    SELECT x.uei, x.name, x.city, x.state, x.zip, x.url, x.trades, x.certs, x.naics, x.expires::date, ${extractDate}::date, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS x(uei TEXT, name TEXT, city TEXT, state TEXT, zip TEXT, url TEXT, trades TEXT[], certs TEXT[], naics TEXT[], expires TEXT)
    ON CONFLICT (uei) DO UPDATE SET
      name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, url = EXCLUDED.url,
      trades = EXCLUDED.trades, certs = EXCLUDED.certs, naics = EXCLUDED.naics, expires = EXCLUDED.expires,
      extract_date = EXCLUDED.extract_date, updated_at = NOW()
  `;
}

/** Drop businesses that are no longer in the latest extract (expired, opted out, no longer small). */
export async function pruneSamRegistrants(extractDate: string): Promise<number> {
  const rows = (await sql()`DELETE FROM sam_registrants WHERE extract_date < ${extractDate}::date RETURNING uei`) as unknown[];
  return rows.length;
}

export async function samRegistrantCount(): Promise<number> {
  const rows = (await sql()`SELECT COUNT(*)::int AS n FROM sam_registrants`) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

export interface RegisteredSub {
  uei: string;
  name: string;
  city: string | null;
  url: string | null;
  certs: string[];
}

/** Registered small businesses for one trade in one state, certified ones first. Empty if the table isn't there yet. */
export async function findRegisteredSubs(q: { trade: string; state: string; cert: string | null; limit: number }): Promise<{ total: number; rows: RegisteredSub[] }> {
  try {
    const s = sql();
    const certPred = q.cert ? s`AND ${q.cert} = ANY(certs)` : s``;
    const [count, rows] = await Promise.all([
      s`SELECT COUNT(*)::int AS n FROM sam_registrants WHERE state = ${q.state} AND ${q.trade} = ANY(trades) ${certPred}`,
      s`SELECT uei, name, city, url, certs FROM sam_registrants
        WHERE state = ${q.state} AND ${q.trade} = ANY(trades) ${certPred}
        ORDER BY cardinality(certs) DESC, (url IS NOT NULL) DESC, name ASC
        LIMIT ${q.limit}`,
    ]);
    return { total: Number((count as { n: number }[])[0]?.n ?? 0), rows: rows as RegisteredSub[] };
  } catch {
    return { total: 0, rows: [] };
  }
}

/** How many are registered for a trade in a state, and how many hold each certification (no names). */
export async function registeredSubCounts(trade: string, state: string): Promise<{ total: number; certs: Record<string, number> }> {
  try {
    const rows = (await sql()`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE 'sdvosb' = ANY(certs))::int AS sdvosb,
             COUNT(*) FILTER (WHERE 'vosb' = ANY(certs))::int AS vosb,
             COUNT(*) FILTER (WHERE 'wosb' = ANY(certs))::int AS wosb,
             COUNT(*) FILTER (WHERE '8a' = ANY(certs))::int AS a8,
             COUNT(*) FILTER (WHERE 'hubzone' = ANY(certs))::int AS hubzone
      FROM sam_registrants WHERE state = ${state} AND ${trade} = ANY(trades)
    `) as Record<string, number>[];
    const r = rows[0] ?? {};
    return { total: Number(r.total ?? 0), certs: { sdvosb: Number(r.sdvosb ?? 0), vosb: Number(r.vosb ?? 0), wosb: Number(r.wosb ?? 0), "8a": Number(r.a8 ?? 0), hubzone: Number(r.hubzone ?? 0) } };
  } catch {
    return { total: 0, certs: {} };
  }
}

/** Registered small businesses in a set of cities (e.g. Tampa Bay) for some trades, certified first. */
export async function registeredSubsInCities(q: { state: string; cities: readonly string[]; trades: string[]; limit: number }): Promise<{ total: number; certs: Record<string, number>; rows: (RegisteredSub & { trades: string[] })[] }> {
  try {
    const s = sql();
    const cities = q.cities.map((c) => c.toLowerCase());
    const [count, rows] = await Promise.all([
      s`SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE 'vosb' = ANY(certs))::int AS vosb,
               COUNT(*) FILTER (WHERE 'sdvosb' = ANY(certs))::int AS sdvosb,
               COUNT(*) FILTER (WHERE 'wosb' = ANY(certs))::int AS wosb
        FROM sam_registrants WHERE state = ${q.state} AND LOWER(city) = ANY(${cities}) AND trades && ${q.trades}`,
      s`SELECT uei, name, city, url, certs, trades FROM sam_registrants
        WHERE state = ${q.state} AND LOWER(city) = ANY(${cities}) AND trades && ${q.trades}
        ORDER BY cardinality(certs) DESC, (url IS NOT NULL) DESC, name ASC
        LIMIT ${q.limit}`,
    ]);
    const c = (count as Record<string, number>[])[0] ?? {};
    return { total: Number(c.total ?? 0), certs: { vosb: Number(c.vosb ?? 0), sdvosb: Number(c.sdvosb ?? 0), wosb: Number(c.wosb ?? 0) }, rows: rows as (RegisteredSub & { trades: string[] })[] };
  } catch {
    return { total: 0, certs: {}, rows: [] };
  }
}
