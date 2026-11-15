import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { warmLeads } from "~/lib/outreach.server";

/**
 * GET /api/admin/warm-leads — admin only (owner 2026-11-15). Accounts without a paid plan that
 * have opened /upgrade or /pricing, most recent first. Read-only.
 */
async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    const leads = await warmLeads();
    return Response.json({ leads }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[api/admin/warm-leads] failed:", err);
    return Response.json({ error: "Could not load warm leads" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/warm-leads")({ server: { handlers: { GET: get } } });
