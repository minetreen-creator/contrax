/**
 * Federal winning prices near a bid — database side. See ~/lib/area-awards.
 * The winners and each award's amount are only ever returned for a paid viewer. Everyone else
 * gets the count and the typical size range (two rounded percentiles, no winner, no single award).
 */
import { sql } from "~/db";
import { ensureAwardLeadsTable } from "~/lib/award-leads.server";
import { AWARD_FEED_LATE_DAYS, AWARD_HISTORY_IN_ESTIMATES, usaspendingUrl } from "~/lib/award-leads";
import { NAICS_NAMES } from "~/lib/naics-names";
import {
  AREA_AWARDS_LIST,
  AREA_AWARDS_MIN_EXACT,
  areaAwardScopes,
  medianAmount,
  typicalRange,
  type AreaAwards,
  type TypicalSize,
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
  // Until a period of history is loaded in full, leave history rows out of every figure here
  // (see AWARD_HISTORY_IN_ESTIMATES): a part-loaded period holds only its largest awards.
  const settled = AWARD_HISTORY_IN_ESTIMATES ? s`` : s`AND (awarded_on IS NULL OR first_seen_at::date - awarded_on <= ${AWARD_FEED_LATE_DAYS})`;
  type Agg = { n: number; since: string | null; p25: number | null; p75: number | null };
  const aggregate = async (pattern: string, inState: boolean): Promise<Agg> => {
    const [row] = (inState
      ? await s`
          SELECT COUNT(*)::int AS n, MIN(awarded_on)::text AS since,
                 (percentile_cont(0.25) WITHIN GROUP (ORDER BY amount))::float AS p25,
                 (percentile_cont(0.75) WITHIN GROUP (ORDER BY amount))::float AS p75
          FROM award_leads
          WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0 ${settled}`
      : await s`
          SELECT COUNT(*)::int AS n, MIN(awarded_on)::text AS since,
                 (percentile_cont(0.25) WITHIN GROUP (ORDER BY amount))::float AS p25,
                 (percentile_cont(0.75) WITHIN GROUP (ORDER BY amount))::float AS p75
          FROM award_leads
          WHERE naics_code ~ ${pattern} AND amount > 0 ${settled}`) as Agg[];
    return { n: Number(row?.n ?? 0), since: row?.since ?? null, p25: row?.p25 ?? null, p75: row?.p75 ?? null };
  };
  const sized = (a: Agg, scope: "state" | "nation"): TypicalSize | null => {
    const r = typicalRange(a.n, a.p25, a.p75);
    return r ? { ...r, scope, count: a.n } : null;
  };

  // The state's own contracts first: exact code, widened when the exact code has too few.
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    const pattern = `^(${scope.prefixes.join("|")})`;
    const agg = await aggregate(pattern, true);
    const total = agg.n;
    const last = i === scopes.length - 1;
    if (total === 0 || (total < AREA_AWARDS_MIN_EXACT && !last)) continue;
    let detail: AreaAwards["detail"] = null;
    if (paid) {
      const amounts = (await s`
        SELECT amount::float AS amount FROM award_leads
        WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0 ${settled}
      `) as { amount: number }[];
      const list = (await s`
        SELECT award_key, recipient_name, amount::float AS amount, agency, sub_agency, awarded_on::text AS awarded_on
        FROM award_leads
        WHERE pop_state = ${state} AND naics_code ~ ${pattern} AND amount > 0 ${settled}
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
    // Too few in the state for a range → the same work nationwide, and say so.
    const typical = sized(agg, "state") ?? sized(await aggregate(pattern, false), "nation");
    return { label: scope.label, state, total, since: agg.since, typical, detail };
  }
  // No contract in the state at all: a nationwide size estimate on its own, when there is one.
  for (const scope of scopes) {
    const typical = sized(await aggregate(`^(${scope.prefixes.join("|")})`, false), "nation");
    if (typical) return { label: scope.label, state, total: 0, since: null, typical, detail: null };
  }
  return null;
}
