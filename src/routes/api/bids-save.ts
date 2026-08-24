import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { hasProfessionalAccess, loadUserTrialStatus, FREE_SAVE_LIMIT } from "~/lib/trial";
// The exact message surfaced to a non-Professional user who's hit the free
// saved-bid limit. Kept in sync with the client-side paywall (SaveToPipeline /
// dashboard) — see src/components/PremiumUpgradeModal.tsx.
const SAVE_LIMIT_MESSAGE =
  "You've reached your free limit. Upgrade to track unlimited opportunities.";
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { bidId?: unknown } | null;
    const bidId = Number(body?.bidId);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    // Free saved-bid limit: a non-Professional user may actively track at most
    // FREE_SAVE_LIMIT bids. Admins / demo / Professional+ users bypass. The
    // incoming bid_id is excluded so re-saving an already-saved bid (or moving
    // a dismissed bid back to open) never counts against the cap.
    const trial = await loadUserTrialStatus(user.id);
    if (!hasProfessionalAccess(trial, user)) {
      const rows = await sql()`SELECT COUNT(*)::int AS c FROM saved_matches WHERE user_id = ${user.id} AND status = 'saved' AND bid_id <> ${bidId}`;
      if ((rows[0]?.c ?? 0) >= FREE_SAVE_LIMIT) {
        return Response.json({ error: "save_limit", message: SAVE_LIMIT_MESSAGE }, { status: 403 });
      }
    }
    await sql()`INSERT INTO saved_matches (user_id, bid_id, status) VALUES (${user.id}, ${bidId}, 'saved') ON CONFLICT (user_id, bid_id) DO UPDATE SET status = 'saved'`;
    try {
    await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql()`INSERT INTO team_activity (member_email, action, bid_id, details) VALUES (${user.email}, 'saved_bid', ${bidId}, 'a bid')`;
  } catch { /* workspace telemetry is intentionally non-blocking */ }
    return Response.json({ success: true });  } catch (err) {
    console.error("[api/bids-save] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save bid" },
      { status: 500 },
    );
  }
}
export const Route = createFileRoute("/api/bids-save")({
  server: { handlers: { POST: handler } },
});
