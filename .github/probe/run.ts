// Read-only, aggregate-only check of the data the gap map would use. No names, emails or ids.
import { sql } from "~/db";
const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
await q("spending by trade/year", sql()`SELECT trade_slug, fiscal_year, COUNT(*)::int AS states, ROUND(SUM(total_amount)/1e6)::int AS total_m, ROUND(SUM(set_aside_amount)/1e6)::int AS setaside_m, MAX(synced_at)::date AS synced FROM federal_trade_spending GROUP BY 1,2 ORDER BY 1,2`);
await q("spending top_agencies sample shape", sql()`SELECT jsonb_typeof(top_agencies) AS t, jsonb_array_length(top_agencies) AS n, (top_agencies->0) AS first FROM federal_trade_spending WHERE trade_slug='janitorial' AND state='VA' ORDER BY fiscal_year DESC LIMIT 1`);
await q("recompetes by trade", sql()`SELECT trade_slug, COUNT(*)::int AS n, COUNT(DISTINCT pop_state)::int AS states, MIN(end_date) AS min_end, MAX(end_date) AS max_end, COUNT(*) FILTER (WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '12 months')::int AS next12 FROM recompete_contracts GROUP BY 1 ORDER BY 2 DESC`);
await q("award_leads overall", sql()`SELECT COUNT(*)::int AS n, MIN(awarded_on) AS min_d, MAX(awarded_on) AS max_d, COUNT(DISTINCT pop_state)::int AS states, COUNT(DISTINCT LEFT(naics_code,6))::int AS naics, COUNT(DISTINCT recipient_uei)::int AS winners FROM award_leads`);
await q("award_leads by naics (top 25)", sql()`SELECT naics_code, COUNT(*)::int AS n, COUNT(DISTINCT recipient_uei)::int AS winners FROM award_leads GROUP BY 1 ORDER BY 2 DESC LIMIT 25`);
await q("open bids by category", sql()`SELECT category, COUNT(*)::int AS n FROM bids WHERE due_date > NOW() GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
process.exit(0);
