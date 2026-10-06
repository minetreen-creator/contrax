import { createFileRoute } from "@tanstack/react-router";
import { applyPlanStates, parseFeedQuery } from "~/lib/data-feed";
import { feedUserFromRequest, queryFeed } from "~/lib/data-feed.server";

/**
 * GET /api/v1/feed — the Contrax bid data feed (owner 2026-10-06), sold to
 * businesses. Open opportunities only (deadline in the future, award notices
 * and low-content rows excluded), keyset-paged by id.
 *
 *   Authorization: Bearer <key>   (Stripe plan or /admin/data-access), or
 *   X-RapidAPI-Proxy-Secret       (RapidAPI marketplace buyers)
 *   ?state=VA,NC  ?updated_since=ISO  ?naics=2382,561720  ?set_aside=SDVOSB
 *   ?limit=1..500 (default 100)  ?after=<next_after from the previous page>
 *
 * Docs: https://www.contrax.company/data
 */
async function handler({ request }: { request: Request }) {
  try {
    const auth = await feedUserFromRequest(request);
    if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });
    if (auth.tier === "leads" || auth.tier === "primes") {
      return Response.json({ error: "Your plan doesn't include the bid feed. Open bids need a Starter or Pro plan: https://www.contrax.company/data" }, { status: 403 });
    }
    const parsed = parseFeedQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    const scoped = applyPlanStates(parsed.query, auth.allowedStates);
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: 403 });
    const { rows, nextAfter } = await queryFeed(scoped.query);
    return Response.json(
      { data: rows, next_after: nextAfter, count: rows.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/v1/feed] error:", err);
    return Response.json({ error: "Feed unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/v1/feed")({ server: { handlers: { GET: handler } } });
