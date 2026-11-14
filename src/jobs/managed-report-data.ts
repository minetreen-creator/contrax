/**
 * Managed report data — CLI entrypoint (`bun run managed-report-data`), run by
 * hand from .github/workflows/managed-report-data.yml (owner 2026-11-14). Prints
 * the numbers behind a Contrax Managed pipeline report for one trade and state:
 * the federal contracts ending in the window, by agency and by month, the
 * largest ones, and the open bids in that trade. READ-ONLY; writes nothing.
 * The output between the markers is one JSON object.
 */
import { sql } from "~/db";
import { addMonths } from "~/lib/federal-trade-data";
import { ensureFederalTradeTables } from "~/lib/federal-trade-data.server";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { STATE_NAMES } from "~/lib/contract-map";

async function main() {
  const state = (process.env.STATE ?? "VA").trim().toUpperCase();
  const trade = (process.env.TRADE ?? "it-services").trim().toLowerCase();
  const months = Math.min(Math.max(Number(process.env.MONTHS) || 12, 1), 18);
  const tradeRow = SEO_TRADE_BY_SLUG[trade];
  if (!tradeRow || !STATE_NAMES[state]) throw new Error(`Unknown STATE "${state}" or TRADE "${trade}"`);
  await ensureFederalTradeTables();
  const s = sql();
  const until = addMonths(new Date().toISOString().slice(0, 10), months);
  const where = s`trade_slug = ${trade} AND pop_state = ${state} AND end_date >= CURRENT_DATE AND end_date <= ${until}`;
  const [totals, byAgency, byMonth, largest, holders] = await Promise.all([
    s`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total, COUNT(DISTINCT recipient_name)::int AS holders FROM recompete_contracts WHERE ${where}`,
    s`SELECT COALESCE(sub_agency, agency, 'Unknown') AS agency, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY total DESC LIMIT 12`,
    s`SELECT to_char(date_trunc('month', end_date), 'YYYY-MM') AS month, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY 1`,
    s`SELECT award_id, recipient_name, amount::float AS amount, to_char(end_date, 'YYYY-MM-DD') AS end_date, agency, sub_agency, LEFT(COALESCE(description, ''), 220) AS description, naics_code
      FROM recompete_contracts WHERE ${where} AND end_date <= CURRENT_DATE + 180 ORDER BY amount DESC LIMIT 25`,
    s`SELECT recipient_name, COUNT(*)::int AS n, SUM(amount)::float AS total FROM recompete_contracts WHERE ${where} GROUP BY 1 ORDER BY total DESC LIMIT 10`,
  ]);
  const like = `%${tradeRow.radarTerm.toLowerCase()}%`;
  const openBids = await s`
    SELECT id, LEFT(title, 160) AS title, agency, to_char(due_date, 'YYYY-MM-DD') AS due FROM bids
    WHERE normalized_state = ${state} AND due_date >= NOW() + INTERVAL '7 days'
      AND (LOWER(title) LIKE ${like} OR LOWER(COALESCE(description, '')) LIKE ${like})
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    ORDER BY due_date ASC LIMIT 15`;
  const out = { state, trade, tradeLabel: tradeRow.label, months, asOf: new Date().toISOString().slice(0, 10), until, totals: (totals as unknown[])[0], byAgency, byMonth, largest, holders, openBids };
  console.log("===MANAGED-REPORT-JSON-START===");
  console.log(JSON.stringify(out));
  console.log("===MANAGED-REPORT-JSON-END===");
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Managed report data crashed:", e);
      process.exit(1);
    });
}
