import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    await sql()`CREATE TABLE IF NOT EXISTS pricing_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, suggested_low DECIMAL(10,2), suggested_high DECIMAL(10,2), suggested_median DECIMAL(10,2), confidence INTEGER, comparable_awards JSONB DEFAULT '[]'::jsonb, rationale TEXT, pricing_strategy TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const rows = await sql()`SELECT * FROM pricing_recommendations WHERE user_email = ${user.email}`;
    return Response.json((rows as any[]).map((r: any) => ({
      bid_id: String(r.bid_id), bid_title: r.bid_title || "", suggested_low: Number(r.suggested_low), suggested_high: Number(r.suggested_high), suggested_median: Number(r.suggested_median), confidence: Number(r.confidence), comparable_awards: Array.isArray(r.comparable_awards) ? r.comparable_awards : [], rationale: r.rationale || "", pricing_strategy: r.pricing_strategy || "competitive", created_at: String(r.created_at),
    })));
  } catch { return Response.json([]); }
}
export const Route = createFileRoute("/api/pricing-cache")({ server: { handlers: { GET: handler } } });
