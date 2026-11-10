import { createFileRoute } from "@tanstack/react-router";
import { coopTradeForQuery } from "~/lib/coop-contracts";

/**
 * GET /api/coop-open?trade=<Radar search> — open co-op solicitations for that trade (src/lib/coop-contracts.ts),
 * for Radar's "co-op category open" note. Public data only; cached an hour.
 */
async function get({ request }: { request: Request }) {
  const trade = coopTradeForQuery(new URL(request.url).searchParams.get("trade")?.slice(0, 120));
  if (!trade) return Response.json({ trade: null, count: 0, next: null }, { headers: { "Cache-Control": "public, max-age=3600" } });
  const { openCoopSolicitations } = await import("~/lib/coop-contracts.server");
  const open = (await openCoopSolicitations(trade)).filter((s) => s.dueAt);
  const next = open[0] ? { title: open[0].title, coop: open[0].coop, dueAt: open[0].dueAt } : null;
  return Response.json({ trade, count: open.length, next }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

export const Route = createFileRoute("/api/coop-open")({ server: { handlers: { GET: get } } });
