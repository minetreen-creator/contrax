import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

// Mirrors fetchTrackedBidIds in src/routes/dashboard.tsx (migrated from a
// createServerFn client RPC that silently failed on production).
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json([]);
  try {
    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const rows = await sql()`SELECT bid_id FROM tracked_bids WHERE user_email = ${user.email}`;
    return Response.json((rows as any[]).map((r) => String(r.bid_id)));
  } catch {
    return Response.json([]);
  }
}

export const Route = createFileRoute("/api/dashboard-tracked")({
  server: { handlers: { GET: handler } },
});
