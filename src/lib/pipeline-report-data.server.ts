/**
 * The numbers behind a pipeline report for one trade and state (owner 2026-11-14). One function
 * feeds the Managed report data job and the public sample report, so the sample is always what a
 * buyer would get. READ-ONLY. Federal contracts come from recompete_contracts (USAspending.gov);
 * open bids from the bids table, kept only when the title reads as this trade.
 */
import { sql } from "~/db";
import { STATE_NAMES } from "~/lib/contract-map";
import { addMonths } from "~/lib/federal-trade-data";
import { ensureFederalTradeTables } from "~/lib/federal-trade-data.server";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { tradeForText } from "~/lib/pipeline-report";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

export interface ReportData {
  state: string;
  stateName: string;
  trade: string;
  tradeLabel: string;
  months: number;
  asOf: string;
  until: string;
  totals: { n: number; total: number; holders: number };
  /** What contracts like these were awarded for: the middle half and the midpoint, in dollars. */
  priceRange: { low: number; median: number; high: number } | null;
  byAgency: { agency: string; n: number; total: number }[];
  byMonth: { month: string; n: number; total: number }[];
  largest: { award_key: string; award_id: string; recipient_name: string; amount: number; end_date: string; agency: string | null; sub_agency: string | null; description: string; naics_code: string | null }[];
  /** `hasPlan`: on the SBA or GSA directory of primes with a small-business subcontracting plan (the Prime Finder's source). */
  holders: { recipient_name: string; n: number; total: number; hasPlan: boolean }[];
  openBids: { id: number; title: string; agency: string | null; due: string }[];
}

export const REPORT_OPEN_BIDS = 5;

export async function reportData(stateIn: string, tradeIn: string, monthsIn = 12): Promise<ReportData> {
  const state = stateIn.trim().toUpperCase();
  const trade = tradeIn.trim().toLowerCase();
  const months = Math.min(Math.max(Number(monthsIn) || 12, 1), 18);
  const tradeRow = SEO_TRADE_BY_SLUG[trade];
  if (!tradeRow || !STATE_NAMES[state]) throw new Error(`Unknown STATE "${state}" or TRADE "${trade}"`);
  await ensureFederalTradeTables();
  const s = sql();
  const until = addMonths(new Date().toISOString().slice(0, 10), months);
  const where = s`trade_slug = ${trade} AND pop_state = ${state} AND end_date >= CURRENT_DATE AND end_date <= ${until}`;
  const [totals, byAgency, byMonth, largest, holders, range] = await Promise.all([
    s`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total, COUNT(DISTINCT recipient_name)::int AS holders FROM recompete_contracts WHERE ${where}`,
    s`SELECT COALESCE(sub_agency, agency, 'Unknown') AS agency, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY total DESC LIMIT 12`,
    s`SELECT to_char(date_trunc('month', end_date), 'YYYY-MM') AS month, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY 1`,
    s`SELECT award_key, award_id, recipient_name, amount::float AS amount, to_char(end_date, 'YYYY-MM-DD') AS end_date, agency, sub_agency, LEFT(COALESCE(description, ''), 220) AS description, naics_code
      FROM recompete_contracts WHERE ${where} AND end_date <= CURRENT_DATE + 180 ORDER BY amount DESC LIMIT 25`,
    s`SELECT recipient_name, MAX(recipient_uei) AS uei, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY total DESC LIMIT 10`,
    s`SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY amount)::float AS low, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::float AS median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::float AS high FROM recompete_contracts WHERE ${where} AND amount > 0`,
  ]);
  const like = `%${tradeRow.radarTerm.toLowerCase()}%`;
  const candidates = (await s`
    SELECT id, LEFT(title, 160) AS title, agency, to_char(due_date, 'YYYY-MM-DD') AS due FROM bids
    WHERE normalized_state = ${state} AND due_date >= NOW() + INTERVAL '7 days'
      AND (LOWER(title) LIKE ${like} OR LOWER(COALESCE(description, '')) LIKE ${like})
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    ORDER BY due_date ASC LIMIT 60`) as ReportData["openBids"];
  // A description can mention the trade in passing; the title has to read as this line of work.
  const openBids = candidates.filter((b) => tradeForText(b.title) === trade).slice(0, REPORT_OPEN_BIDS);
  // Which of the top holders must subcontract to small businesses. Its own query, so a missing
  // directory table costs the badge and nothing else.
  const held = holders as { recipient_name: string; uei: string | null; n: number; total: number }[];
  let withPlan = new Set<string>();
  try {
    const ueis = held.map((h) => h.uei).filter((u): u is string => Boolean(u));
    if (ueis.length) withPlan = new Set(((await s`SELECT DISTINCT uei FROM subcontract_primes WHERE uei = ANY(${ueis})`) as { uei: string }[]).map((x) => x.uei));
  } catch (e) {
    console.warn("[pipeline-report-data] subcontracting-plan lookup failed (no badges):", (e as Error).message);
  }
  const r = (range as { low: number | null; median: number | null; high: number | null }[])[0];
  return {
    state, stateName: STATE_NAMES[state], trade, tradeLabel: tradeRow.label, months,
    asOf: new Date().toISOString().slice(0, 10), until,
    totals: (totals as ReportData["totals"][])[0],
    priceRange: r && r.median != null ? { low: Number(r.low), median: Number(r.median), high: Number(r.high) } : null,
    byAgency: byAgency as ReportData["byAgency"], byMonth: byMonth as ReportData["byMonth"],
    largest: largest as ReportData["largest"],
    holders: held.map((h) => ({ recipient_name: h.recipient_name, n: h.n, total: h.total, hasPlan: Boolean(h.uei && withPlan.has(h.uei)) })),
    openBids,
  };
}
