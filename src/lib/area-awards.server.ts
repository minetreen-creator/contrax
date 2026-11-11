/**
 * Federal winning prices near a bid — database side. See ~/lib/area-awards.
 * The winners and each award's amount are only ever returned for a paid viewer. Everyone else
 * gets the count and the typical size range (two rounded percentiles, no winner, no single award).
 */
import { sql } from "~/db";
import { ensureAwardLeadsTable } from "~/lib/award-leads.server";
import { usaspendingUrl } from "~/lib/award-leads";
import { NAICS_NAMES } from "~/lib/naics-names";
import {
  AREA_AWARDS_LIST,
  AREA_AWARDS_MIN_EXACT,
  areaAwardScopes,
  medianAmount,
  typicalRange,
  type AreaAwards,
} from "~/lib/area-awards";

export async function loadAreaAwards(
  state: string | null,
  naics: string | null,
  category: string | null,
  paid: boolean,
): Promise<AreaAwards | null> {
  if (!state || !/^[A-Z]{2}$/.test(state)) return null;
  const scopes = areaAwardScopes(naics, category, (c) => NAICS_NAMES[c]);
  if (!scopes.length) return null;
  await ensureAwardLeadsTable();
  const s = sql();
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    const pattern = `^(${scope.prefixes.join("|")})`;
    const [agg] = (await s`
      SELECT COUNT(*)::int AS n, MIN(awarded_on)::text AS since,
             (percentile_cont(0.25) WITHIN GROUP (ORDER BY amount))::float AS p25,
             (percentile_cont(0.75) WITHIN GROUP (ORDER BY amount))::float AS p75
      FROM award_leads
      WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0
    `) as { n: number; since: string | null; p25: number | null; p75: number | null }[];
    const total = Number(agg?.n ?? 0);
    const last = i === scopes.length - 1;
    if (total === 0 || (total < AREA_AWARDS_MIN_EXACT && !last)) continue;
    let detail: AreaAwards["detail"] = null;
    if (paid) {
      const amounts = (await s`
        SELECT amount::float AS amount FROM award_leads
        WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0
      `) as { amount: number }[];
      const list = (await s`
        SELECT award_key, recipient_name, amount::float AS amount, agency, sub_agency, awarded_on::text AS awarded_on
        FROM award_leads
        WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0
        ORDER BY awarded_on DESC NULLS LAST, amount DESC
        LIMIT ${AREA_AWARDS_LIST}
      `) as { award_key: string; recipient_name: string; amount: number; agency: string | null; sub_agency: string | null; awarded_on: string | null }[];
      const nums = amounts.map((r) => Number(r.amount));
      detail = {
        median: medianAmount(nums) ?? 0,
        low: Math.min(...nums),
        high: Math.max(...nums),
        awards: list.map((r) => ({
          winner: r.recipient_name,
          amount: Number(r.amount),
          agency: r.sub_agency || r.agency,
          awardedOn: r.awarded_on,
          url: usaspendingUrl(r.award_key),
        })),
      };
    }
    return { label: scope.label, state, total, since: agg?.since ?? null, typical: typicalRange(total, agg?.p25, agg?.p75), detail };
  }
  return null;
}
