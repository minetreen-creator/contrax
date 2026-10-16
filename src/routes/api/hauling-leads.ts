import { createFileRoute } from "@tanstack/react-router";
import { HAULING_LEAD_DISPLAY_LIMIT } from "~/lib/hauling-leads";
import { queryHaulingLeads } from "~/lib/hauling-leads.server";

/**
 * GET /api/hauling-leads?state=VA — the stored hauling leads for the /subcontracts
 * section: recent federal awards whose published scope plausibly involves hauling
 * (owner-endorsed definition R, trucking queue item #4).
 *
 * NEWEST FIRST, capped at HAULING_LEAD_DISPLAY_LIMIT. With `state`, that state's leads
 * are returned; when the state has none in the stored window the response says so
 * (`nationalFallback: true`) and carries the national list instead of an empty box.
 * `stored` is the honest denominator (how many leads the last syncs stored in total).
 *
 * FAIL-CLOSED: if the store cannot be read the route returns 503 and the section shows
 * nothing rather than an empty-looking list.
 */
async function handler({ request }: { request: Request }) {
  try {
    const params = new URL(request.url).searchParams;
    const view = await queryHaulingLeads({
      state: params.get("state"),
      limit: HAULING_LEAD_DISPLAY_LIMIT,
    });
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/hauling-leads] error:", err);
    return Response.json(
      { error: "The stored hauling leads could not be read." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/hauling-leads")({
  server: { handlers: { GET: handler } },
});
