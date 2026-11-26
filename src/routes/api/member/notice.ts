import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { NOTICE_SWEEP_LIMIT, NOTICE_SWEEP_SECONDS, verifyMemberNotice } from "~/lib/member-notice-link.server";

/**
 * GET /api/member/notice?b=<bid>&u=<member>&s=<signature> — the link behind each bid in the paid
 * morning email (src/lib/member-notice-link.server.ts). Records that the member opened the notice and
 * sends them on to the government's own page.
 *
 * Always ends in a redirect, whatever fails:
 *  - a good signature → the bid's official page (its Contrax page when the bid has no usable link);
 *  - a bad or missing signature → the bid's Contrax page, which applies the members-only lock, so
 *    this address never hands the official link to someone who was not emailed it;
 *  - no such bid → the dashboard.
 */
const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
const id = (raw: string | null) => {
  const n = Number((raw ?? "").trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

async function handler({ request }: { request: Request }) {
  const home = "https://www.contrax.company/dashboard";
  try {
    const q = new URL(request.url).searchParams;
    const bidId = id(q.get("b"));
    const userId = id(q.get("u"));
    if (!bidId) return redirect(home);
    const page = `https://www.contrax.company/bid/${bidId}`;
    if (!userId || !verifyMemberNotice(userId, bidId, q.get("s") ?? "")) return redirect(page);

    let official: string | null = null;
    try {
      const [bid] = (await sql()`SELECT source_url FROM bids WHERE id = ${bidId} LIMIT 1`) as { source_url: string | null }[];
      if (bid && /^https?:\/\/[^\s"'<>]+$/i.test(String(bid.source_url ?? ""))) official = String(bid.source_url);
    } catch (e) {
      console.error("[api/member/notice] bid lookup failed (redirecting anyway):", (e as Error).message);
    }

    try {
      // A mail scanner opens every link at once: past the limit, stop recording (the person still gets their page).
      const [recent] = (await sql()`
        SELECT COUNT(*)::int AS n FROM bid_notice_opens
        WHERE user_id = ${userId} AND opened_at > NOW() - ${`${NOTICE_SWEEP_SECONDS} seconds`}::interval`.catch(() => [{ n: 0 }])) as { n: number }[];
      if ((recent?.n ?? 0) < NOTICE_SWEEP_LIMIT) {
        const { recordNoticeOpen } = await import("~/lib/member-bid-activity.server");
        await recordNoticeOpen(userId, bidId);
      }
    } catch (e) {
      console.error("[api/member/notice] record failed (redirecting anyway):", (e as Error).message);
    }
    return redirect(official ?? page);
  } catch (e) {
    console.error("[api/member/notice] failed (redirecting anyway):", (e as Error).message);
    return redirect(home);
  }
}

export const Route = createFileRoute("/api/member/notice")({ server: { handlers: { GET: handler } } });
