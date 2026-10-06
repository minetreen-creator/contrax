import { createFileRoute } from "@tanstack/react-router";
import { parseLeadQuery, usaspendingUrl } from "~/lib/award-leads";
import { queryAwardLeads } from "~/lib/award-leads.server";
import { tierHasAwardLeads } from "~/lib/data-feed-billing.server";
import { feedUserFromRequest } from "~/lib/data-feed.server";

/**
 * GET /api/v1/awards — new federal contract winners (owner 2026-10-06, idea #6),
 * from public USAspending.gov records. Award Leads or Pro plan key.
 *
 *   Authorization: Bearer <key>
 *   ?state=VA,NC (work or winner state)  ?naics=2382  ?since=2026-10-01
 *   ?min_amount=100000  ?limit=1..1000 (default 100)  ?after=<next_after>
 */
async function handler({ request }: { request: Request }) {
  try {
    const auth = await feedUserFromRequest(request);
    if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });
    if (auth.rapidApi || !tierHasAwardLeads(auth.tier)) {
      return Response.json({ error: "Award leads come with the Award Leads or Pro plan: https://www.contrax.company/leads" }, { status: 403 });
    }
    const parsed = parseLeadQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const { rows, nextAfter } = await queryAwardLeads(parsed.query);
    const data = rows.map(({ award_key, ...r }) => ({ ...r, usaspending_url: usaspendingUrl(award_key) }));
    return Response.json({ data, next_after: nextAfter, count: data.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/v1/awards] error:", err);
    return Response.json({ error: "Award leads unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/v1/awards")({ server: { handlers: { GET: handler } } });
