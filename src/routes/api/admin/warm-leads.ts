import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { qaExternalUserSQL } from "~/lib/qa-exclusion";
import type { WarmLead } from "~/lib/warm-leads";

/**
 * GET /api/admin/warm-leads — admin only (owner 2026-11-15). Accounts without a paid plan that
 * have opened /upgrade or /pricing, most recent first. Read-only.
 */
async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    const rows = (await sql()`
      SELECT u.id, u.email, u.company_name, u.created_at, v.looks, v.last_look
      FROM users u
      JOIN (
        SELECT user_id, COUNT(DISTINCT COALESCE(visit_id, created_at::date::text))::int AS looks, MAX(created_at) AS last_look
        FROM page_views
        WHERE user_id IS NOT NULL AND (path LIKE '/upgrade%' OR path LIKE '/pricing%')
        GROUP BY user_id
      ) v ON v.user_id = u.id::text
      WHERE ${sql().unsafe(qaExternalUserSQL())}
        AND COALESCE(u.subscription_status, '') <> 'active'
        AND NOT COALESCE(u.full_access, false)
      ORDER BY v.last_look DESC
      LIMIT 100
    `) as { id: number; email: string; company_name: string | null; created_at: string | null; looks: number; last_look: string | null }[];
    const leads: WarmLead[] = rows.map((r) => ({
      id: r.id, email: r.email, company: r.company_name, looks: r.looks,
      signedUp: r.created_at ? new Date(r.created_at).toISOString() : null,
      lastLook: r.last_look ? new Date(r.last_look).toISOString() : null,
    }));
    return Response.json({ leads }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[api/admin/warm-leads] failed:", err);
    return Response.json({ error: "Could not load warm leads" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/warm-leads")({ server: { handlers: { GET: get } } });
