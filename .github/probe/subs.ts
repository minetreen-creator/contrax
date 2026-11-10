// Read-only, counts only: Sub Finder supply.
import { sql } from "~/db";
const s = sql();
const q = async (label: string, p: Promise<unknown>) => { try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 120)); } };
await q("profiles", s`SELECT COUNT(*)::int AS profiles, COUNT(*) FILTER (WHERE COALESCE((to_jsonb(p)->>'listed_for_primes')::boolean,false))::int AS listed FROM business_profiles p`);
await q("users", s`SELECT COUNT(*)::int AS users, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS new30 FROM users`);
await q("signups by week", s`SELECT date_trunc('week', created_at)::date AS wk, COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '42 days' GROUP BY 1 ORDER BY 1`);
await q("trade packages", s`SELECT COUNT(*)::int FROM trade_packages`);
await q("responses", s`SELECT COUNT(*)::int FROM trade_package_responses`);
await q("profiles with trade+state", s`SELECT COUNT(*)::int FROM business_profiles WHERE cardinality(COALESCE(locations,'{}')) > 0 AND (cardinality(COALESCE(naics_codes,'{}')) > 0 OR COALESCE(industry,'') <> '')`);
await q("sub finder events 7d", s`SELECT event, COUNT(*)::int FROM analytics_events WHERE created_at > NOW() - INTERVAL '7 days' AND (event LIKE 'sub_finder%' OR event LIKE 'trade_package%' OR event LIKE 'find_subs%' OR event LIKE 'tampa%') GROUP BY 1 ORDER BY 2 DESC`);
