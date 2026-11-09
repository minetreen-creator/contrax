/** Loads the gap map for one trade from the synced USAspending tables (cached 1 hour). */
import { sql } from "~/db";
import { buildGapMap, type GapState } from "~/lib/gap-map";

export interface GapMapData {
  trade: string;
  fiscalYear: number | null;
  states: GapState[];
}

const cache = new Map<string, { at: number; data: GapMapData }>();
const TTL = 60 * 60 * 1000;

export async function loadGapMap(trade: string): Promise<GapMapData> {
  const hit = cache.get(trade);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const spend = (await sql()`
    SELECT state, fiscal_year, total_amount, set_aside_amount, top_agencies
    FROM federal_trade_spending
    WHERE trade_slug = ${trade}
      AND fiscal_year = (SELECT MAX(fiscal_year) FROM federal_trade_spending WHERE trade_slug = ${trade})
  `) as { state: string; fiscal_year: number; total_amount: number; set_aside_amount: number; top_agencies: unknown }[];
  const ending = (await sql()`
    SELECT pop_state AS state,
           COUNT(*) FILTER (WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '12 months')::int AS ending12,
           COALESCE(SUM(amount) FILTER (WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '12 months'), 0)::float8 AS ending12_value,
           COUNT(DISTINCT COALESCE(NULLIF(recipient_uei, ''), UPPER(recipient_name)))::int AS holders
    FROM recompete_contracts
    WHERE trade_slug = ${trade} AND end_date >= NOW()
    GROUP BY pop_state
  `) as { state: string; ending12: number; ending12_value: number; holders: number }[];
  const byState = new Map(ending.map((e) => [e.state, e]));
  const states = buildGapMap(
    spend.map((s) => {
      const e = byState.get(s.state);
      const agencies = Array.isArray(s.top_agencies) ? (s.top_agencies as { name?: unknown; amount?: unknown }[]) : [];
      return {
        state: s.state,
        spend: Number(s.total_amount) || 0,
        setAsideSpend: Number(s.set_aside_amount) || 0,
        topAgencies: agencies
          .map((a) => ({ name: String(a?.name ?? ""), amount: Number(a?.amount) || 0 }))
          .filter((a) => a.name)
          .slice(0, 3),
        ending12: Number(e?.ending12 ?? 0),
        ending12Value: Number(e?.ending12_value ?? 0),
        holders: Number(e?.holders ?? 0),
      };
    }),
  );
  const data = { trade, fiscalYear: spend[0]?.fiscal_year ?? null, states };
  cache.set(trade, { at: Date.now(), data });
  return data;
}
