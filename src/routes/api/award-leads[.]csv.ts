import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { leadsToCsv, parseLeadQuery } from "~/lib/award-leads";
import { queryAwardLeads } from "~/lib/award-leads.server";
import { tierHasAwardLeads } from "~/lib/data-feed-billing.server";
import { dataPlanForUser } from "~/lib/data-feed.server";

/**
 * GET /api/award-leads.csv?state=VA&naics=23&since=2026-09-01 — spreadsheet of
 * new federal contract winners for signed-in Award Leads / Pro customers (and the
 * owner). Same filters as /api/v1/awards; up to 1,000 rows (limit defaults to 1000).
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Sign in to download award leads." }, { status: 401 });
    const plan = user.is_admin ? { tier: null } : await dataPlanForUser(user.id);
    if (!plan || !tierHasAwardLeads(plan.tier)) {
      return Response.json({ error: "Award leads come with the Award Leads or Pro plan: https://www.contrax.company/leads" }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    if (!params.has("limit")) params.set("limit", "1000");
    // Without a date, the last 30 days (the newest winners are what buyers call first).
    if (!params.has("since")) params.set("since", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
    const parsed = parseLeadQuery(params);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const { rows } = await queryAwardLeads(parsed.query);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(leadsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contrax-award-leads-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/award-leads.csv] error:", err);
    return Response.json({ error: "Download unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/award-leads.csv")({ server: { handlers: { GET: handler } } });
