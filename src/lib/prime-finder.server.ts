/** Loads the prime contractor finder for one trade and state (cached 1 hour). */
import { sql } from "~/db";
import { sortPrimes, type PrimeRow } from "~/lib/prime-finder";

const cache = new Map<string, { at: number; rows: PrimeRow[] }>();
const TTL = 60 * 60 * 1000;

export async function loadPrimes(trade: string, state: string | null): Promise<PrimeRow[]> {
  const key = `${trade}|${state ?? "US"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const s = sql();
  const stateFilter = state ? s`AND r.pop_state = ${state}` : s``;
  const rows = (await s`
    SELECT r.recipient_uei AS uei,
           MAX(r.recipient_name) AS name,
           COUNT(*)::int AS contracts,
           SUM(r.amount)::float8 AS value,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.agency), NULL) AS agencies,
           MIN(r.end_date) AS next_end,
           BOOL_OR(p.uei IS NOT NULL) AS has_plan,
           MAX(p.plan_type) AS plan_type,
           MAX(p.parent) AS parent
    FROM recompete_contracts r
    LEFT JOIN (
      SELECT DISTINCT ON (uei) uei, subcontract_plan_type AS plan_type, ultimate_parent_name AS parent
      FROM subcontract_primes ORDER BY uei, fetched_at DESC
    ) p ON p.uei = r.recipient_uei
    WHERE r.trade_slug = ${trade} AND r.end_date >= NOW() ${stateFilter}
    GROUP BY r.recipient_uei
  `) as { uei: string; name: string; contracts: number; value: number; agencies: string[] | null; next_end: string | Date | null; has_plan: boolean; plan_type: string | null; parent: string | null }[];
  const out = sortPrimes(
    rows.map((r) => ({
      uei: r.uei,
      name: r.name,
      parent: r.parent && r.parent.toUpperCase() !== String(r.name).toUpperCase() ? r.parent : null,
      contracts: Number(r.contracts),
      value: Number(r.value) || 0,
      agencies: (r.agencies ?? []).filter(Boolean).slice(0, 4),
      nextEnd: r.next_end ? new Date(r.next_end).toISOString().slice(0, 10) : null,
      hasPlan: Boolean(r.has_plan),
      planType: r.plan_type ?? null,
    })),
  );
  cache.set(key, { at: Date.now(), rows: out });
  return out;
}

/** The signed-in member's own profile fields for the intro email draft (never anyone else's). */
export async function loadIntroProfile(userId: number) {
  const rows = (await sql()`
    SELECT business_name, service_categories, locations, certifications, years_in_business, past_performance_summary
    FROM business_profiles WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1
  `) as Record<string, any>[];
  const p = rows[0];
  if (!p) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    businessName: p.business_name ?? null,
    services: list(p.service_categories),
    locations: list(p.locations),
    certifications: list(p.certifications),
    yearsInBusiness: p.years_in_business ?? null,
    pastPerformance: p.past_performance_summary ?? null,
  };
}
