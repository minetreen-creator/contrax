import { createFileRoute } from "@tanstack/react-router";
import { applyPlanStates, parseFeedQuery } from "~/lib/data-feed";
import { countRequest, countRows, feedUserFromRequest, queryAmendments } from "~/lib/data-feed.server";

/**
 * GET /api/v1/amendments — changes to open bids' listings (deadline moved,
 * retitled, description or value changed), recorded by the sync since
 * 2026-10-22 (bid-amendments.ts). Same keys, plan states, source rules and
 * daily cap as /api/v1/feed.
 *
 *   ?since=ISO  ?state=VA,NC  ?limit=1..500 (default 100)  ?after=<next_after>
 */
async function handler({ request }: { request: Request }) {
  try {
    const auth = await feedUserFromRequest(request);
    if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });
    const quota = await countRequest(auth.access);
    if (!quota.ok) {
      return Response.json(
        { error: `Daily request limit reached (${auth.access.dailyLimit}). It resets at midnight UTC.` },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
    if (auth.tier === "leads" || auth.tier === "primes") {
      return Response.json({ error: "Your plan doesn't include the bid feed: https://www.contrax.company/data" }, { status: 403 });
    }
    const params = new URL(request.url).searchParams;
    // Reuse the feed's validation for state / limit / after / a date.
    const asFeed = new URLSearchParams();
    for (const k of ["state", "limit", "after"]) {
      const v = params.get(k);
      if (v != null) asFeed.set(k, v);
    }
    const since = params.get("since");
    if (since != null) asFeed.set("updated_since", since);
    const parsed = parseFeedQuery(asFeed);
    if (!parsed.ok) return Response.json({ error: parsed.error.replace("updated_since", "since") }, { status: 400 });
    const scoped = applyPlanStates(parsed.query, auth.allowedStates);
    if (!scoped.ok) return Response.json({ error: scoped.error }, { status: 403 });
    const { rows, nextAfter } = await queryAmendments(
      { since: scoped.query.updatedSince, after: scoped.query.after, limit: scoped.query.limit, states: scoped.query.states },
      auth.access,
    );
    await countRows(auth.access, rows.length);
    return Response.json({ data: rows, next_after: nextAfter, count: rows.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/v1/amendments] error:", err);
    return Response.json({ error: "Amendments unavailable" }, { status: 500 });
  }
}


export const Route = createFileRoute("/api/v1/amendments")({ server: { handlers: { GET: handler } } });
