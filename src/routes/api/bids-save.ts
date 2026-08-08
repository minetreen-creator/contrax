import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { bidId?: unknown } | null;
    const bidId = Number(body?.bidId);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
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
