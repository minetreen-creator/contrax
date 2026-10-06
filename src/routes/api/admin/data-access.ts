import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { addMissingWebhookEvents, dataFeedWebhookStatus } from "~/lib/data-feed-billing.server";
import { grantDataAccess, listDataAccess, revokeDataAccess } from "~/lib/data-feed.server";

/**
 * GET  /api/admin/data-access → data feed access requests + active grants
 * POST /api/admin/data-access → { action: "grant", email, note? } issues a key
 *                               (returned once) | { action: "revoke", userId }
 *                               | { action: "webhook-check" | "webhook-fix" }
 * Admin only (owner 2026-10-06).
 */
async function guard(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return null;
}

async function get({ request }: { request: Request }) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    return Response.json(await listDataAccess());
  } catch (err) {
    console.error("[api/admin/data-access] list error:", err);
    return Response.json({ error: "Failed to load data access" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string; email?: string; note?: string; userId?: number };
    if (body.action === "grant") {
      const email = String(body.email ?? "").trim();
      if (!email) return Response.json({ error: "Email is required." }, { status: 400 });
      const r = await grantDataAccess(email, body.note ? String(body.note).slice(0, 300) : null);
      return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 404 });
    }
    if (body.action === "revoke") {
      const id = Number(body.userId);
      if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "userId is required." }, { status: 400 });
      await revokeDataAccess(id);
      return Response.json({ ok: true });
    }
    if (body.action === "webhook-check" || body.action === "webhook-fix") {
      try {
        const endpoints = body.action === "webhook-fix" ? await addMissingWebhookEvents() : await dataFeedWebhookStatus();
        return Response.json({ endpoints });
      } catch (err) {
        console.error("[api/admin/data-access] stripe webhook error:", err);
        return Response.json({ error: `Stripe: ${err instanceof Error ? err.message : "request failed"}` }, { status: 502 });
      }
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("[api/admin/data-access] action error:", err);
    return Response.json({ error: "Action failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/data-access")({ server: { handlers: { GET: get, POST: post } } });
