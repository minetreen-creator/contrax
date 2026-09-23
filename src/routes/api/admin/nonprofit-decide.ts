import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { decideNonprofitApplication, isNonprofitReviewAction } from "~/lib/nonprofit-review.server";

/**
 * POST /api/admin/nonprofit-decide   { id, action, note }
 *
 *   action: "approve" | "deny" | "request_info" | "release"
 *
 * The reviewer's ONE write path. Body shape and validation follow
 * /api/admin/watch-visitor: malformed JSON → 400, an unknown action → 400, a missing id
 * → 400. Everything else is the lib's job — the guarded UPDATE (0 rows ⇒ 409 "already
 * actioned"), the append-only audit row, and the owner's transition rules.
 *
 * ADMIN-GATED (Option A: `is_admin` OR the ADMIN_EMAILS allowlist, resolved in
 * ~/lib/api-auth): 401 unauthenticated, 403 non-admin. `note` is required by `deny`
 * (a denial always carries a written, internal reason) and optional elsewhere; the note
 * is internal and is never rendered to an applicant.
 *
 * `transfer` is deliberately NOT accepted — it stays schema-ready in migration 046's
 * CHECK with no UI and no route (lead ruling (ii)).
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    let body: { id?: unknown; action?: unknown; note?: unknown };
    try {
      body = (await request.json()) as { id?: unknown; action?: unknown; note?: unknown };
    } catch {
      return Response.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    const id = typeof body.id === "number" ? body.id : Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "A numeric application id is required." }, { status: 400 });
    }
    if (!isNonprofitReviewAction(body.action)) {
      return Response.json({ error: "Unknown review action" }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

    const result = await decideNonprofitApplication(
      { applicationId: id, action: body.action, note, actor: { id: user.id, email: user.email } },
    );
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[api/admin/nonprofit-decide] error:", err);
    return Response.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/nonprofit-decide")({
  server: { handlers: { POST: handler } },
});
