import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

/**
 * GET /api/my-pipeline
 *
 * Lists the authenticated user's saved matches (status = 'saved'), joined to
 * bid info for display in the "My Pipeline" page. Auth-required: 401 without a
 * valid session cookie.
 *
 * Returns { data: PipelineItem[] } where PipelineItem is:
 *   { id, bid_id, status, created_at, title, agency, estimated_value,
 *     due_date, location, category, source_url, set_aside }
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const rows = await sql()`
      SELECT sm.id, sm.bid_id, sm.status, sm.created_at,
             b.title, b.agency, b.estimated_value, b.due_date, b.location,
             b.category, b.source_url, b.set_aside
      FROM saved_matches sm
      JOIN bids b ON b.id = sm.bid_id
      WHERE sm.user_id = ${user.id} AND sm.status = 'saved'
      ORDER BY sm.created_at DESC NULLS LAST, b.due_date ASC NULLS LAST
    `;
    const data = (rows as any[]).map((r) => ({
      id: Number(r.id),
      bid_id: Number(r.bid_id),
      status: r.status ?? "saved",
      created_at: r.created_at ? String(r.created_at) : null,
      title: r.title || "Untitled opportunity",
      agency: r.agency || "Unknown agency",
      estimated_value: r.estimated_value || "Not specified",
      due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
      location: r.location ?? null,
      category: r.category ?? null,
      source_url: r.source_url ?? null,
      set_aside: r.set_aside ?? null,
    }));
    return Response.json({ data });
  } catch (err) {
    console.error("[api/my-pipeline] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load pipeline" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/my-pipeline")({
  server: { handlers: { GET: handler } },
});
