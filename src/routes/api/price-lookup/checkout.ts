import { createFileRoute } from "@tanstack/react-router";
import { isBlockedIp } from "~/lib/request-ip";

/**
 * POST { bidId } → { url } for the $9 "What did this sell for?" lookup (owner 2026-11-14). Offered
 * only when the bid has similar federal awards on record, so nothing is sold that comes back empty.
 */
async function handler({ request }: { request: Request }) {
  if (isBlockedIp(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  let bidId = 0;
  try {
    bidId = Number(((await request.json()) as Record<string, unknown>).bidId);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!Number.isInteger(bidId) || bidId <= 0) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const { checkIpLimit } = await import("~/lib/rate-limit");
    if (!(await checkIpLimit(request, "price-lookup-checkout", 20, 3600)).allowed) return Response.json({ error: "Too many tries. Please wait a bit." }, { status: 429 });
    const { sql } = await import("~/db");
    const rows = (await sql()`SELECT title, location, agency, naics_code, category FROM bids WHERE id = ${bidId} LIMIT 1`) as {
      title: string; location: string | null; agency: string | null; naics_code: string | null; category: string | null;
    }[];
    const b = rows[0];
    if (!b) return Response.json({ error: "Bid not found" }, { status: 404 });
    const { resolveBidState } = await import("~/lib/location-state");
    const { loadAreaAwards } = await import("~/lib/area-awards.server");
    const awards = await loadAreaAwards(resolveBidState(b.location, b.agency) ?? null, b.naics_code, b.category, false);
    if (!awards || awards.total <= 0) return Response.json({ error: "No similar awards on record for this bid." }, { status: 409 });
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser().catch(() => null);
    const { createPriceLookupCheckout } = await import("~/lib/price-lookup.server");
    return Response.json({ url: await createPriceLookupCheckout(bidId, b.title, user?.email ?? null) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[price-lookup/checkout]", (e as Error).message);
    return Response.json({ error: "Checkout is unavailable right now." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/price-lookup/checkout")({ server: { handlers: { POST: handler } } });
