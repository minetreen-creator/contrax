import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";

/**
 * POST /api/bid-notice-open { bid_id } — a signed-in member opened a bid's official notice (owner
 * 2026-11-23, src/lib/member-bid-activity.ts). Sent as a beacon when the link is tapped; it records
 * one row per member and bid and never blocks the link. Signed-out callers are ignored (204).
 */
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return new Response(null, { status: 204 });
    const body = (await request.json().catch(() => null)) as { bid_id?: unknown } | null;
    const bidId = Number(body?.bid_id);
    if (!Number.isSafeInteger(bidId) || bidId <= 0) return Response.json({ error: "Invalid bid" }, { status: 400 });
    const { recordNoticeOpen } = await import("~/lib/member-bid-activity.server");
    await recordNoticeOpen(Number(user.id), bidId);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("[api/bid-notice-open] failed (non-fatal)", e);
    return new Response(null, { status: 204 });
  }
}

export const Route = createFileRoute("/api/bid-notice-open")({
  server: { handlers: { POST: handler } },
});
