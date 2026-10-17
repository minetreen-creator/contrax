import { createFileRoute } from "@tanstack/react-router";
import { activeContractAmounts, tradeSpendingFor } from "~/lib/federal-trade-data.server";
import { parseCalculatorQuery, typicalContract, type WinCalculatorResult } from "~/lib/win-calculator";

/**
 * GET /api/win-calculator?trade=janitorial&state=VA (owner 2026-10-17)
 * Public, read-only figures for the homepage "What could you win?" calculator.
 * Unknown trade/state → 400. No stored figures → zeros (the page says so).
 */
async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  const q = parseCalculatorQuery(url.searchParams.get("trade"), url.searchParams.get("state"));
  if (!q) return Response.json({ error: "Pick a trade and state." }, { status: 400 });
  try {
    const [spending, amounts] = await Promise.all([tradeSpendingFor(q.trade, q.state), activeContractAmounts(q.trade, q.state)]);
    const result: WinCalculatorResult = {
      trade: q.trade,
      state: q.state,
      fiscalYear: spending?.fiscal_year ?? null,
      spent: spending?.total_amount ?? 0,
      setAside: spending?.set_aside_amount ?? 0,
      topAgencies: spending?.top_agencies ?? [],
      typicalContract: typicalContract(amounts),
      contractCount: amounts.length,
    };
    return Response.json(result, { headers: { "cache-control": "public, max-age=3600, s-maxage=3600" } });
  } catch (error) {
    console.error("[api/win-calculator] error:", error);
    return Response.json({ error: "Figures are unavailable right now." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/win-calculator")({
  server: { handlers: { GET: handler } },
});
