import { createFileRoute } from "@tanstack/react-router";
import { getBidScoutFunnel30d, type BidScoutFunnelResult } from "~/lib/bid-scout-funnel";
import { getUserFromRequest } from "~/lib/api-auth";

/**
 * GET /api/admin/bid-scout-funnel
 *
 * Admin-only 3-stage Bid Scout funnel (owner 2026-09-11, Phase B):
 *   Bid Scout viewed → Checkout started → Purchased.
 *
 * SEPARATE from the canonical unified funnel and from the Radar Conversion /
 * Autopsy funnels — Bid Scout is an assisted-service path that lives OUTSIDE
 * the self-serve funnel (Qualified visit → Radar completed → Signup completed
 * → Activated → Paid) and a Bid Scout purchase never synthesizes any of those
 * stage events. Same rolling now−30×24h window, same bot/QA/admin exclusions
 * as every other admin funnel. READ-ONLY.
 */
export const handler = async ({ request }: { request: Request }): Promise<Response> => {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const result: BidScoutFunnelResult = await getBidScoutFunnel30d();
  return Response.json(result);
};

export const Route = createFileRoute("/api/admin/bid-scout-funnel")({
  server: { handlers: { GET: handler } },
});