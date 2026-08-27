import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { deriveStateCode, STATE_NAMES } from "~/lib/contract-map";
import { US_STATES } from "~/lib/states";

/**
 * GET /api/contract-map/bids?state=VA
 *
 * Drill-down endpoint for the /map page. Returns the OPEN bids that resolve to
 * the requested state, using the SAME deriveStateCode() as the aggregate map,
 * so the list you get when you click a state exactly matches the count shown on
 * that state in the map. 400 if the state code is not a recognised US state.
 */
async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("state") || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw) || !US_STATES.includes(raw as any)) {
    return Response.json({ error: "Unknown state code" }, { status: 400 });
  }
  const state = raw;
  try {
    const rows = await sql()`
      SELECT id, title, agency, location, set_aside, estimated_value, due_date, source_url
      FROM bids
      WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
      ORDER BY due_date ASC NULLS LAST
    `;
    const bids = (rows as any[])
      .filter((r) => deriveStateCode(r.location) === state)
      .map((r) => ({
        id: r.id,
        title: r.title,
        agency: r.agency,
        location: r.location,
        set_aside: r.set_aside,
        estimated_value: r.estimated_value,
        due_date: r.due_date ? new Date(r.due_date).toISOString() : null,
        source_url: r.source_url,
      }));
    return Response.json({ state, name: STATE_NAMES[state], bids });
  } catch {
    return Response.json({ error: "Bids temporarily unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/contract-map/bids")({
  server: { handlers: { GET: handler } },
});
