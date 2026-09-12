import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getBidScoutFoundersReport } from "~/lib/bid-scout-founders-report";

/**
 * GET /api/admin/bid-scout-founders
 *
 * Admin-only founders-offer reporting (owner spec 2026-09-11 §6). Thin auth
 * wrapper around getBidScoutFoundersReport() — see that lib for the exact
 * semantics (Stripe authoritative redemption state, founders subscriptions,
 * first-month MRR-equivalent $49 × first invoice only, contracted recurring
 * MRR $99 × every active sub). Never changes subscription-table semantics.
 */
export const handler = async ({ request }: { request: Request }): Promise<Response> => {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const report = await getBidScoutFoundersReport();
  return Response.json({ ...report, fetchedAt: new Date().toISOString() });
};

export const Route = createFileRoute("/api/admin/bid-scout-founders")({
  server: { handlers: { GET: handler } },
});