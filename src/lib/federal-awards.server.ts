/**
 * Real federal awards query for /awards (owner 2026-11-08). Kept out of the USAspending sync
 * module (federal-trade-data.server.ts): it only reads the table that sync fills.
 */
import { sql } from "~/db";
import { ensureFederalTradeTables } from "~/lib/federal-trade-data.server";
import type { FederalAward, FederalAwardsSummary } from "~/lib/federal-awards-view";

/**
 * Real federal awards for /awards (owner 2026-11-08): one row per contract (a contract can be
 * stored under several trades), optionally narrowed by a search term (an escaped ILIKE pattern)
 * and a place-of-performance state. Summary numbers cover every match; the list is the newest
 * `listLimit`, so a free viewer's request never carries the member list.
 */
export async function queryFederalAwards(q: { like: string | null; state: string | null; listLimit: number }): Promise<{
  summary: FederalAwardsSummary;
  awards: FederalAward[];
}> {
  await ensureFederalTradeTables();
  const s = sql();
  const likePred = q.like
    ? s`AND (description ILIKE ${q.like} OR recipient_name ILIKE ${q.like} OR naics_description ILIKE ${q.like} OR naics_code LIKE ${q.like})`
    : s``;
  const statePred = q.state ? s`AND pop_state = ${q.state}` : s``;
  const base = s`SELECT DISTINCT ON (award_key) award_key, award_id, recipient_name, amount, start_date, end_date, agency, sub_agency,
      description, pop_state, naics_code, naics_description
    FROM recompete_contracts WHERE amount > 0 ${likePred} ${statePred} ORDER BY award_key, synced_at DESC`;
  const [stats, agencies, winners, rows] = await Promise.all([
    s`WITH a AS (${base}) SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS total,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::float AS med,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY amount)::float AS p25,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::float AS p75 FROM a`,
    s`WITH a AS (${base}) SELECT agency AS name, COUNT(*)::int AS contracts, SUM(amount)::float AS total FROM a
        WHERE agency IS NOT NULL AND agency <> '' GROUP BY agency ORDER BY total DESC LIMIT 8`,
    s`WITH a AS (${base}) SELECT recipient_name AS name, COUNT(*)::int AS contracts, SUM(amount)::float AS total FROM a
        GROUP BY recipient_name ORDER BY total DESC LIMIT 8`,
    s`WITH a AS (${base}) SELECT * FROM a ORDER BY start_date DESC NULLS LAST, amount DESC LIMIT ${q.listLimit}`,
  ]);
  const st = (stats as { n: number; total: number; med: number | null; p25: number | null; p75: number | null }[])[0];
  const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
  return {
    summary: {
      count: st?.n ?? 0,
      total: st?.total ?? 0,
      median: st?.med ?? null,
      p25: st?.p25 ?? null,
      p75: st?.p75 ?? null,
      topAgencies: agencies as { name: string; contracts: number; total: number }[],
      topWinners: winners as { name: string; contracts: number; total: number }[],
    },
    awards: (rows as Record<string, unknown>[]).map((r) => ({
      awardKey: String(r.award_key),
      awardId: String(r.award_id ?? ""),
      recipient: String(r.recipient_name ?? ""),
      amount: Number(r.amount ?? 0),
      startDate: day(r.start_date),
      endDate: day(r.end_date),
      agency: (r.agency as string) ?? null,
      subAgency: (r.sub_agency as string) ?? null,
      description: (r.description as string) ?? null,
      state: (r.pop_state as string) ?? null,
      naicsCode: (r.naics_code as string) ?? null,
      naicsDescription: (r.naics_description as string) ?? null,
    })),
  };
}
