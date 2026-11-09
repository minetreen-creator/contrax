// Read-only, aggregate-only check of the data a prime contractor finder would use. No names, emails or ids.
import { sql } from "~/db";
const q = async (label: string, p: Promise<unknown>) => {
  try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 200)); }
};
await q("subcontract_primes by source/fy", sql()`SELECT s.label, p.fy, COUNT(*)::int AS companies, COUNT(*) FILTER (WHERE p.subcontract_plan_type IS NOT NULL)::int AS with_plan_type, COUNT(*) FILTER (WHERE array_length(p.naics,1) > 0)::int AS with_naics, COUNT(*) FILTER (WHERE p.products_services IS NOT NULL)::int AS with_products FROM subcontract_primes p JOIN subcontract_sources s ON s.id = p.source_id GROUP BY 1,2 ORDER BY 1,2`);
await q("plan types", sql()`SELECT subcontract_plan_type, COUNT(*)::int AS n FROM subcontract_primes GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
await q("recompete holders with uei", sql()`SELECT COUNT(DISTINCT recipient_uei)::int AS holders, COUNT(*) FILTER (WHERE recipient_uei IS NULL OR recipient_uei = '')::int AS rows_no_uei FROM recompete_contracts WHERE end_date >= NOW()`);
await q("holders matched to a subcontracting-plan prime, by trade", sql()`
  SELECT r.trade_slug, COUNT(DISTINCT r.recipient_uei)::int AS holders,
         COUNT(DISTINCT r.recipient_uei) FILTER (WHERE p.uei IS NOT NULL)::int AS plan_primes,
         ROUND(SUM(r.amount) FILTER (WHERE p.uei IS NOT NULL)/1e6)::int AS plan_prime_value_m,
         ROUND(SUM(r.amount)/1e6)::int AS all_value_m
  FROM recompete_contracts r
  LEFT JOIN (SELECT DISTINCT uei FROM subcontract_primes) p ON p.uei = r.recipient_uei
  WHERE r.end_date >= NOW()
  GROUP BY 1 ORDER BY 1`);
await q("janitorial VA example counts", sql()`
  SELECT COUNT(DISTINCT r.recipient_uei)::int AS holders, COUNT(DISTINCT r.recipient_uei) FILTER (WHERE p.uei IS NOT NULL)::int AS plan_primes
  FROM recompete_contracts r LEFT JOIN (SELECT DISTINCT uei FROM subcontract_primes) p ON p.uei = r.recipient_uei
  WHERE r.end_date >= NOW() AND r.trade_slug = 'janitorial' AND r.pop_state = 'VA'`);
await q("award_leads holders matched", sql()`SELECT COUNT(DISTINCT a.recipient_uei)::int AS holders, COUNT(DISTINCT a.recipient_uei) FILTER (WHERE p.uei IS NOT NULL)::int AS plan_primes FROM award_leads a LEFT JOIN (SELECT DISTINCT uei FROM subcontract_primes) p ON p.uei = a.recipient_uei`);
await q("dot directory liaisons", sql()`SELECT COUNT(*)::int AS rows, COUNT(*) FILTER (WHERE liaison IS NOT NULL AND liaison <> '')::int AS with_liaison, COUNT(*) FILTER (WHERE prime_id IS NOT NULL)::int AS matched FROM dot_directory_records`);
process.exit(0);
