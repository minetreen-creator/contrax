import { createFileRoute } from "@tanstack/react-router";
import {
  getBidScoutAcquisitionFunnel30d,
  type BidScoutAcquisitionFunnelResult,
} from "~/lib/bid-scout-acquisition-funnel";
import { getUserFromRequest } from "~/lib/api-auth";
/**
 * GET /api/admin/bid-scout-acquisition-funnel
 *
 * Admin-only Bid Scout ACQUISITION funnel (owner 2026-09-11, Phase B.1):
 *   4 stages (Landing visitors / Form started / Checkout started / Purchased)
 *   + conversion rate + per-source breakdown (facebook / email-outreach /
 *   dashboard / homepage / other-direct), all DISTINCT visitors except
 *   purchased (webhook event rows carry no visitor_id by design — the stage
 *   counts webhook-confirmed purchases, exactly-once).
 *
 * SEPARATE from the canonical unified funnel, the Radar Conversion / Autopsy
 * funnels, and the Phase B "Bid Scout Funnel" card (which counts
 * bid_scout_subscriptions rows). Same rolling now−30×24h window, same
 * bot/QA/admin exclusions. READ-ONLY.
 */
export const handler = async ({ request }: { request: Request }): Promise<Response> => {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) {
    return Response.json({ error: "Admin access required" }, { status: 403 });
  }
  const result: BidScoutAcquisitionFunnelResult = await getBidScoutAcquisitionFunnel30d();
  return Response.json(result);
};
export const Route = createFileRoute("/api/admin/bid-scout-acquisition-funnel")({
  server: { handlers: { GET: handler } },
});