import { createFileRoute } from "@tanstack/react-router";
import { normalizeStateInput } from "~/lib/location-state";
import { neighborStates, recompeteTradeFor } from "~/lib/radar-more";

/**
 * GET /api/radar/more?trade=&state= — real follow-ups for a thin Radar search
 * (src/lib/radar-more.ts): open bids for the trade in bordering states,
 * federal contracts in the state ending within 12 months, and the state's
 * upcoming industry days. Counts and short lists only; each part is empty
 * when there is no data, never estimated.
 */
async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  const trade = (url.searchParams.get("trade") ?? "").trim().slice(0, 60);
  const state = normalizeStateInput(url.searchParams.get("state") ?? "");
  if (!state) return Response.json({ error: "state is required" }, { status: 400 });
  const recompeteTrade = recompeteTradeFor(trade);
  try {
    const [nearby, rebids, events] = await Promise.all([
      trade ? nearbyCounts(trade, state) : Promise.resolve([]),
      recompeteTrade ? rebidsIn(recompeteTrade, state) : Promise.resolve(null),
      industryDaysIn(state),
    ]);
    return Response.json(
      { state, nearby, rebids, events },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } },
    );
  } catch (err) {
    console.error("[api/radar/more] failed:", (err as Error)?.message);
    return Response.json({ state, nearby: [], rebids: null, events: { count: 0, list: [] } });
  }
}

async function nearbyCounts(trade: string, state: string) {
  const { searchOpenBids } = await import("~/lib/max.server");
  const { filterBidsToState } = await import("~/lib/seo-landing");
  const all = await searchOpenBids(trade, null, "any");
  return neighborStates(state)
    .map((s) => ({ state: s, count: filterBidsToState(all, s).length }))
    .filter((n) => n.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

async function rebidsIn(trade: string, state: string) {
  const { queryRecompetes } = await import("~/lib/federal-trade-data.server");
  const r = await queryRecompetes({ trade, state, months: 12, limit: 3 });
  if (!r.count) return null;
  return {
    trade,
    count: r.count,
    total: r.total,
    list: r.rows.map((x) => ({ incumbent: x.recipient_name, amount: x.amount, agency: x.sub_agency || x.agency, ends: x.end_date })),
  };
}

async function industryDaysIn(state: string) {
  const { queryIndustryDays } = await import("~/lib/industry-days-data");
  const rows = (await queryIndustryDays()).filter((r) => r.state === state);
  return { count: rows.length, list: rows.slice(0, 3).map((r) => ({ title: r.title, agency: r.agency, date: r.date, url: r.url })) };
}

export const Route = createFileRoute("/api/radar/more")({ server: { handlers: { GET: handler } } });
