import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { setWatched } from "~/lib/visitor-intel";

/**
 * POST /api/admin/watch-visitor  { visitor_id, action: "watch" | "unwatch" }
 *
 * Admin-only watch toggle for the Visitor Intelligence panel (owner spec
 * 2026-09-05). Persists to `watched_visitors` (self-healing DDL guard in
 * visitor-intel.ts; migration 027 carries the same schema). The journeys board
 * flags watched rows, highlights them, and surfaces "returned since last
 * viewed" from the same table.
 *
 * Always returns JSON with a `watched` boolean; on a storage error it
 * fail-opens with watched=false + an error note rather than 500-ing the panel.
 * Admin/QA/test visitor ids are rejected at this endpoint too — the board never
 * shows those rows, so there is nothing legitimate to watch.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  let visitorId = "";
  let action = "";
  try {
    const body = (await request.json()) as { visitor_id?: unknown; action?: unknown };
    visitorId = typeof body.visitor_id === "string" ? body.visitor_id.trim() : "";
    action = typeof body.action === "string" ? body.action.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!visitorId || visitorId.length > 64) {
    return Response.json({ error: "visitor_id is required" }, { status: 400 });
  }
  if (visitorId.startsWith("qa-probe-") || visitorId.startsWith("qa-manual-exit-")) {
    return Response.json({ error: "Test visitors cannot be watched" }, { status: 400 });
  }
  if (action !== "watch" && action !== "unwatch") {
    return Response.json({ error: 'action must be "watch" or "unwatch"' }, { status: 400 });
  }

  try {
    const result = await setWatched(visitorId, action === "watch");
    return Response.json({ ok: true, visitor_id: visitorId, ...result });
  } catch (err) {
    console.error("[api/admin/watch-visitor] error:", err);
    // Fail-open: watching is an accelerator, never a gate.
    return Response.json({
      ok: false,
      visitor_id: visitorId,
      watched: false,
      watched_since: null,
      error: "Could not persist watch state",
    });
  }
}

export const Route = createFileRoute("/api/admin/watch-visitor")({
  server: { handlers: { POST: handler } },
});
