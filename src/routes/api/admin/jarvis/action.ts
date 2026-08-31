/**
 * POST /api/admin/jarvis/action — OWNER approves / denies a pending L4 action
 * in the `jarvis_actions` approval queue (Phase 6 OWNER CONTROLS).
 *
 * THE OWNER ACTING: this endpoint is admin-only (401 unauthenticated, 403
 * non-admin), so only the owner can approve or deny queue items.
 *
 * Body: { "id": number, "outcome": "approve" | "deny", "reason"?: string }
 *   • approve → status='approved', owner_approved=TRUE (durable, NEVER hard-deleted)
 *   • deny    → status='denied',  owner_approved stays FALSE (record kept, not removed)
 * Only a 'pending' row can be resolved (else 400). Mirrors Phase 1/4 semantics:
 * approved / owner-approved rows are never physically deleted.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { resolveQueueAction } from "~/lib/jarvis/brain";

async function handler({ request }: { request: Request }) {
  let user;
  try {
    user = await getUserFromRequest(request);
  } catch {
    user = null;
  }
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    outcome?: unknown;
    reason?: unknown;
  };
  const id = Number(body.id);
  const outcome = body.outcome;
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid action id" }, { status: 400 });
  }
  if (outcome !== "approve" && outcome !== "deny") {
    return Response.json({ error: "outcome must be 'approve' or 'deny'" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;

  try {
    const db = sql();
    const updated = await resolveQueueAction(db, id, `owner:${user.id}`, outcome, reason);
    if (!updated) return Response.json({ error: "Action not found" }, { status: 404 });
    console.log(
      `[api/admin/jarvis/action] owner ${user.id} ${outcome}d jarvis_action #${id}`,
      JSON.stringify({ decided_by: user.email }),
    );
    return Response.json({ ok: true, id, status: updated.status, owner_approved: updated.owner_approved });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Only-pending guard throws -> 400 so the UI can tell the owner.
    return Response.json({ error: msg }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/admin/jarvis/action")({
  server: { handlers: { POST: handler } },
});
