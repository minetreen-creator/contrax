import { createFileRoute } from "@tanstack/react-router";
import { verifyMemberBidding } from "~/lib/member-notice-link.server";

/**
 * POST /api/member/bidding { b, u, s } — the button on /bidding (owner 2026-11-26). Marks the bid
 * Preparing in the member's pipeline when the signature from their morning email checks out.
 * POST only: a link that a mail scanner follows must never change anything.
 */
const id = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as { b?: unknown; u?: unknown; s?: unknown } | null;
    const bidId = id(body?.b);
    const userId = id(body?.u);
    if (!bidId || !userId || !verifyMemberBidding(userId, bidId, String(body?.s ?? ""))) {
      return Response.json({ error: "This link is not valid. Open the bid from your pipeline instead." }, { status: 403 });
    }
    const { markMemberBidding } = await import("~/lib/member-bidding.server");
    if (!(await markMemberBidding(userId, bidId))) return Response.json({ error: "We could not find that bid." }, { status: 404 });
    return Response.json({ success: true });
  } catch (e) {
    console.error("[api/member/bidding] failed:", (e as Error).message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/member/bidding")({ server: { handlers: { POST: handler } } });
