/**
 * Federal trade data — database + USAspending sync (owner 2026-10-13).
 * See ~/lib/federal-trade-data for what is pulled and why. Tables are created
 * lazily (additive), like award_leads.
 */
import { sql } from "~/db";
import {
  addMonths,
  agencyRequestBody,
  FEDERAL_TRADE_NAICS,
  geographyRequestBody,
  lastCompleteFiscalYear,
  parseAgencies,
  parseGeography,
  pickRecompetes,
  recompeteRequestBody,
  RECOMPETE_WINDOW_MONTHS,
  USASPENDING_API,
  type AgencyAmount,
  type Recompete,
  type TradeSpending,
} from "~/lib/federal-trade-data";

export async function ensureFederalTradeTables(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS recompete_contracts (
    award_key TEXT NOT NULL,
    trade_slug TEXT NOT NULL,
    award_id TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    recipient_uei TEXT,
    amount BIGINT NOT NULL,
    start_date DATE,
    end_date DATE NOT NULL,
    agency TEXT,
    sub_agency TEXT,
    description TEXT,
    pop_state TEXT,
    naics_code TEXT,
    naics_description TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (award_key, trade_slug)
  )`;
  await sql()`CREATE INDEX IF NOT EXISTS recompete_trade_state_end_idx ON recompete_contracts (trade_slug, pop_state, end_date)`;
  await sql()`CREATE TABLE IF NOT EXISTS federal_trade_spending (
    trade_slug TEXT NOT NULL,
    state TEXT NOT NULL,
    fiscal_year INT NOT NULL,
    total_amount DOUBLE PRECISION NOT NULL,
    set_aside_amount DOUBLE PRECISION NOT NULL,
    top_agencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_slug, state, fiscal_year)
  )`;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${USASPENDING_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Contrax/1.0 (+https://www.contrax.company)" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`USAspending ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertRecompetes(rows: Recompete[]): Promise<void> {
  for (const r of rows) {
    await sql()`
      INSERT INTO recompete_contracts (award_key, trade_slug, award_id, recipient_name, recipient_uei, amount, start_date,
                                       end_date, agency, sub_agency, description, pop_state, naics_code, naics_description, synced_at)
      VALUES (${r.award_key}, ${r.trade_slug}, ${r.award_id}, ${r.recipient_name}, ${r.recipient_uei}, ${r.amount}, ${r.start_date},
              ${r.end_date}, ${r.agency}, ${r.sub_agency}, ${r.description}, ${r.pop_state}, ${r.naics_code}, ${r.naics_description}, NOW())
      ON CONFLICT (award_key, trade_slug) DO UPDATE SET
        award_id = EXCLUDED.award_id, recipient_name = EXCLUDED.recipient_name, recipient_uei = EXCLUDED.recipient_uei,
        amount = EXCLUDED.amount, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, agency = EXCLUDED.agency,
        sub_agency = EXCLUDED.sub_agency, description = EXCLUDED.description, pop_state = EXCLUDED.pop_state,
        naics_code = EXCLUDED.naics_code, naics_description = EXCLUDED.naics_description, synced_at = NOW()`;
  }
}

export interface RecompeteSyncResult {
  trade: string;
  pages: number;
  kept: number;
  complete: boolean;
}

/**
 * Walk each trade's contracts (latest end date first) and store the ones ending
 * in the next 18 months. A trade whose walk finished replaces its old rows; one
 * that hit the page cap keeps them, so a partial walk never deletes anything.
 */
export async function syncRecompetes(opts: { dryRun?: boolean; maxPages?: number; trades?: string[]; log?: (s: string) => void } = {}): Promise<RecompeteSyncResult[]> {
  const maxPages = opts.maxPages ?? 300;
  const log = opts.log ?? (() => {});
  const today = new Date().toISOString().slice(0, 10);
  const windowEnd = addMonths(today, RECOMPETE_WINDOW_MONTHS);
  if (!opts.dryRun) await ensureFederalTradeTables();
  const out: RecompeteSyncResult[] = [];
  for (const [trade, naics] of Object.entries(FEDERAL_TRADE_NAICS)) {
    if (opts.trades && !opts.trades.includes(trade)) continue;
    if (!naics.length) continue;
    const runStart = new Date();
    let pages = 0;
    let complete = false;
    let lastEnd = "";
    const kept: Recompete[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await post("/search/spending_by_award/", recompeteRequestBody(naics, page, today));
      const results = (data.results as Record<string, unknown>[] | undefined) ?? [];
      pages++;
      const r = pickRecompetes(results, trade, today, windowEnd);
      kept.push(...r.kept);
      lastEnd = String(results[results.length - 1]?.["End Date"] ?? lastEnd);
      if (page === 1 && results[0]) log(`[recompetes] ${trade} first row end=${String(results[0]["End Date"])}`);
      const hasNext = (data.page_metadata as { hasNext?: boolean } | undefined)?.hasNext;
      if (r.done || !hasNext) {
        complete = true;
        break;
      }
      await pause(300);
    }
    // One award can repeat across pages when the index shifts mid-walk.
    const unique = [...new Map(kept.map((k) => [k.award_key, k])).values()];
    if (!opts.dryRun) {
      await upsertRecompetes(unique);
      if (complete) await sql()`DELETE FROM recompete_contracts WHERE trade_slug = ${trade} AND synced_at < ${runStart}`;
    }
    log(`[recompetes] ${trade}: pages=${pages} kept=${unique.length} complete=${complete} last_end=${lastEnd}`);
    out.push({ trade, pages, kept: unique.length, complete });
  }
  if (!opts.dryRun) await sql()`DELETE FROM recompete_contracts WHERE end_date < CURRENT_DATE`;
  return out;
}

/**
 * Spending per trade per state for the last complete fiscal year: two
 * geography calls per trade (all contracts, small-business set-asides), then
 * the top 3 buying agencies in each state with spending.
 */
export async function syncTradeSpending(opts: { dryRun?: boolean; trades?: string[]; log?: (s: string) => void } = {}): Promise<{ fiscalYear: number; rows: number }> {
  const log = opts.log ?? (() => {});
  const fy = lastCompleteFiscalYear(new Date().toISOString().slice(0, 10));
  if (!opts.dryRun) await ensureFederalTradeTables();
  let rows = 0;
  for (const [trade, naics] of Object.entries(FEDERAL_TRADE_NAICS)) {
    if (opts.trades && !opts.trades.includes(trade)) continue;
    if (!naics.length) continue;
    const total = parseGeography((await post("/search/spending_by_geography/", geographyRequestBody(naics, fy, false))).results);
    await pause(300);
    const setAside = parseGeography((await post("/search/spending_by_geography/", geographyRequestBody(naics, fy, true))).results);
    log(`[spending] ${trade} FY${fy}: ${total.size} states, ${setAside.size} with set-aside spending`);
    for (const [state, amount] of total) {
      if (!(amount > 0)) continue;
      await pause(250);
      let agencies: AgencyAmount[] = [];
      try {
        agencies = parseAgencies((await post("/search/spending_by_category/awarding_agency/", agencyRequestBody(naics, fy, state))).results);
      } catch (e) {
        log(`[spending] ${trade} ${state} agencies failed: ${(e as Error).message}`);
      }
      const row: TradeSpending = { trade_slug: trade, state, fiscal_year: fy, total_amount: amount, set_aside_amount: Math.max(0, setAside.get(state) ?? 0), top_agencies: agencies };
      if (rows < 3) log(`[spending] sample ${JSON.stringify(row)}`);
      rows++;
      if (!opts.dryRun) {
        await sql()`
          INSERT INTO federal_trade_spending (trade_slug, state, fiscal_year, total_amount, set_aside_amount, top_agencies, synced_at)
          VALUES (${row.trade_slug}, ${row.state}, ${row.fiscal_year}, ${row.total_amount}, ${row.set_aside_amount}, ${JSON.stringify(row.top_agencies)}::jsonb, NOW())
          ON CONFLICT (trade_slug, state, fiscal_year) DO UPDATE SET
            total_amount = EXCLUDED.total_amount, set_aside_amount = EXCLUDED.set_aside_amount,
            top_agencies = EXCLUDED.top_agencies, synced_at = NOW()`;
      }
    }
  }
  return { fiscalYear: fy, rows };
}

/** Days since spending was last synced (Infinity when never). */
export async function spendingAgeDays(): Promise<number> {
  await ensureFederalTradeTables();
  const r = (await sql()`SELECT EXTRACT(EPOCH FROM (NOW() - MAX(synced_at))) / 86400 AS days FROM federal_trade_spending`) as { days: number | null }[];
  return r[0]?.days == null ? Infinity : Number(r[0].days);
}

// ─── Reads ────────────────────────────────────────────────────────────────────

const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

function rowToRecompete(r: Record<string, unknown>): Recompete {
  return {
    award_key: String(r.award_key),
    trade_slug: String(r.trade_slug),
    award_id: String(r.award_id),
    recipient_name: String(r.recipient_name),
    recipient_uei: (r.recipient_uei as string) ?? null,
    amount: Number(r.amount),
    start_date: day(r.start_date),
    end_date: day(r.end_date) ?? "",
    agency: (r.agency as string) ?? null,
    sub_agency: (r.sub_agency as string) ?? null,
    description: (r.description as string) ?? null,
    pop_state: (r.pop_state as string) ?? null,
    naics_code: (r.naics_code as string) ?? null,
    naics_description: (r.naics_description as string) ?? null,
  };
}

/** Contracts in a trade (and optional state) ending within `months`, soonest first. */
export async function queryRecompetes(q: { trade: string; state: string | null; months: number; limit: number }): Promise<{ count: number; total: number; rows: Recompete[] }> {
  await ensureFederalTradeTables();
  const s = sql();
  const statePred = q.state ? s`AND pop_state = ${q.state}` : s``;
  const until = addMonths(new Date().toISOString().slice(0, 10), q.months);
  const [counts, rows] = await Promise.all([
    s`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total FROM recompete_contracts
      WHERE trade_slug = ${q.trade} AND end_date >= CURRENT_DATE AND end_date <= ${until} ${statePred}`,
    s`SELECT * FROM recompete_contracts
      WHERE trade_slug = ${q.trade} AND end_date >= CURRENT_DATE AND end_date <= ${until} ${statePred}
      ORDER BY end_date ASC, amount DESC LIMIT ${q.limit}`,
  ]);
  const c = (counts as { n: number; total: number }[])[0] ?? { n: 0, total: 0 };
  return { count: c.n, total: c.total, rows: (rows as Record<string, unknown>[]).map(rowToRecompete) };
}

/** Latest fiscal year's spending for a trade in a state, or null when none is stored. */
export async function tradeSpendingFor(trade: string, state: string): Promise<TradeSpending | null> {
  await ensureFederalTradeTables();
  const r = (await sql()`
    SELECT * FROM federal_trade_spending WHERE trade_slug = ${trade} AND state = ${state}
    ORDER BY fiscal_year DESC LIMIT 1`) as Record<string, unknown>[];
  const row = r[0];
  if (!row) return null;
  const agencies = typeof row.top_agencies === "string" ? JSON.parse(row.top_agencies) : row.top_agencies;
  return {
    trade_slug: String(row.trade_slug),
    state: String(row.state),
    fiscal_year: Number(row.fiscal_year),
    total_amount: Number(row.total_amount),
    set_aside_amount: Number(row.set_aside_amount),
    top_agencies: Array.isArray(agencies) ? (agencies as AgencyAmount[]) : [],
  };
}
