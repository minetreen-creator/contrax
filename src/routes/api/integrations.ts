import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

type Integration = { id: number; provider: string; status: string; connected_at: string | null };
async function ensureIntegrationsTable() { await sql()`CREATE TABLE IF NOT EXISTS integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL CHECK (provider IN ('google_calendar','outlook_calendar','slack','teams','google_drive','onedrive')), access_token TEXT, refresh_token TEXT, status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('active','disconnected')), connected_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, provider))`; }
async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const u = await getUserFromRequest(request);
    if (!u) return Response.json({ error: "Not authenticated" }, { status: 401 });
    await ensureIntegrationsTable();
    const userRows = await sql()`SELECT plan_tier FROM users WHERE id=${u.id} LIMIT 1`;
    const planTier = (userRows.length ? (userRows[0] as any).plan_tier : null) as string | null;
    const rows = await sql()`SELECT id, provider, status, connected_at FROM integrations WHERE user_id=${u.id} ORDER BY provider`;
    return Response.json({ planTier, integrations: rows as Integration[] });
  } catch (err) { console.error("[api/integrations] error:", err); return Response.json({ error: err instanceof Error ? err.message : "Integrations load failed" }, { status: 500 }); }
}
export const Route = createFileRoute("/api/integrations")({ server: { handlers: { GET: handler } } });
