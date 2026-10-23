import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { outreachOverview, renderContact, sendDrafts, setPostalAddress, skipAllDrafts, skipDraft, suppress } from "~/lib/outreach.server";

/**
 * GET  /api/admin/outreach → today's drafts (with rendered previews), recent
 *                            sends, stats and the mailing address
 * POST /api/admin/outreach → { action: "send", ids } | { action: "skip", id } | { action: "skip_all" }
 *                            | { action: "suppress", email } | { action: "address", address }
 * Admin only (owner 2026-10-23; see src/lib/outreach.ts).
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
    const o = await outreachOverview();
    const address = o.postalAddress ?? "[mailing address not set]";
    const drafts = o.drafts.map((d) => ({ ...d, preview: renderContact(d, address) }));
    return Response.json({ ...o, drafts });
  } catch (err) {
    console.error("[api/admin/outreach] load error:", err);
    return Response.json({ error: "Failed to load outreach" }, { status: 500 });
  }
}

async function post({ request }: { request: Request }) {
  const denied = await guard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; ids?: unknown; id?: unknown; email?: unknown; address?: unknown };
  try {
    switch (body.action) {
      case "send": {
        const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
        return Response.json(await sendDrafts(ids));
      }
      case "skip":
        await skipDraft(Number(body.id));
        return Response.json({ ok: true });
      case "skip_all":
        return Response.json({ skipped: await skipAllDrafts("skipped from admin") });
      case "suppress":
        if (typeof body.email !== "string" || !body.email.includes("@")) return Response.json({ error: "Email required" }, { status: 400 });
        await suppress(body.email, "manual");
        return Response.json({ ok: true });
      case "address":
        await setPostalAddress(String(body.address ?? ""));
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    console.error("[api/admin/outreach] action error:", err);
    return Response.json({ error: message }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/admin/outreach")({ server: { handlers: { GET: get, POST: post } } });
