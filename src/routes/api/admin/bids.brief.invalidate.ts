/**
 * POST /api/admin/bids/brief/invalidate — admin-only cache invalidation for the
 * AI RFP Executive Brief (point 8).
 *
 * Clears ai_summary + its cache metadata for a single bid, making the summary
 * eligible for regeneration on next request (the UI then shows the normal
 * "Generate Instant Brief" affordance). This is the admin control for forcing a
 * refresh when a solicitation was amended or a summary is known-to-be-wrong,
 * beyond the automatic content-hash staleness detection.
 *
 * Auth: admin only (mirrors the other /api/admin/* routes).
 * Body: { "bidId": number } — or ?bidId= for a GET-style call.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    let bidId: number;
    const url = new URL(request.url);
    const q = url.searchParams.get("bidId");
    if (q !== null) {
      bidId = Number(q);
    } else {
      const body = (await request.json().catch(() => ({}))) as { bidId?: unknown };
      bidId = Number(body.bidId);
    }
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }

    const db = sql();
    // Clear the cache fields; ai_summary_at too so there's no stale timestamp.
    const result = (await db`
      UPDATE bids
      SET ai_summary = NULL,
          ai_summary_at = NULL,
          ai_summary_source_hash = NULL,
          ai_summary_schema_version = NULL,
          ai_summary_model = NULL,
          ai_summary_generated_from_updated_at = NULL
      WHERE id = ${bidId}
      RETURNING id
    `) as Array<{ id: number }>;
    if (!result.length) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }
    console.log(
      "[ai-brief] admin invalidated AI summary cache",
      JSON.stringify({ bid_id: bidId, by: user.id }),
    );
    return Response.json({ ok: true, bidId, invalidated: true });
  } catch (err) {
    console.error("[api/admin/bids/brief/invalidate] error:", err);
    return Response.json({ error: "Invalidation unavailable" }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/admin/bids/brief/invalidate")({
  server: { handlers: { POST: handler } },
});
