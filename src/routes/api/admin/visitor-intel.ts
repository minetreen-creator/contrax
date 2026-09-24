import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getVisitorIntel, updateWatchedViewedAt } from "~/lib/visitor-intel";
import { sql } from "~/db";

/**
 * GET /api/admin/visitor-intel?visitor_id=<id>
 *
 * Per-visitor Visitor Intelligence payload for the admin "Visitor Journeys"
 * panel (owner spec 2026-09-05). Admin-only — same gating as the journeys
 * board (getCurrentUser via getUserFromRequest + is_admin).
 *
 * Aggregates, for ONE visitor (every query targeted by visitor_id — indexed,
 * no board-wide scans):
 *   - acquisition  source/medium/campaign (+referrer host), landing path,
 *                  first/last seen ISO dates, sessions
 *   - location     city/region — ALWAYS approximate / IP-derived (flag in payload)
 *   - device       device_type + browser_label
 *   - engagement   steps, sessions, returning flag, first/last paths, last action
 *   - interests    RULE-BASED inference from paths/events (labeled inferred in UI)
 *   - contracts    real /bid/<id> page views joined to the live bids table
 *                  (title/agency/set-aside/NAICS/location) with view counts
 *   - radar        voluntarily-entered criteria from radar_saves ("Save your
 *                  matches") — only what the visitor themselves submitted
 *   - lead_score   0–100 heuristic + High/Medium/Low + explicit reasons list
 *   - signals      conversion booleans derived from real rows
 *   - identity     "Anonymous" unless an account/email is actually linked;
 *                  even then the email is masked to local-part@…
 *
 * Expanding a row also marks the visitor VIEWED (watched_visitors.last_viewed_at
 * = NOW) so "returned since last viewed" resets from real admin attention.
 *
 * The SAME bot / @test.contrax / ADMIN_EMAILS exclusions as the journeys board
 * are applied to the detail queries, so a panel always agrees with its row.
 * Returns raw first/latest IPs only to authenticated admins. Each successful
 * detail access is recorded in an append-only audit table. Never returns full
 * emails or raw user-agent / referrer URLs.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const visitorId = url.searchParams.get("visitor_id");
  if (!visitorId || visitorId.length > 64) {
    return Response.json({ error: "visitor_id is required" }, { status: 400 });
  }

  try {
    const intel = await getVisitorIntel(visitorId);
    if (!intel) return Response.json({ error: "Visitor not found" }, { status: 404 });
    try {
      await sql()`CREATE TABLE IF NOT EXISTS admin_network_access_audit (
        id BIGSERIAL PRIMARY KEY,
        admin_user_id INTEGER NOT NULL,
        admin_email TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql()`INSERT INTO admin_network_access_audit
        (admin_user_id, admin_email, visitor_id)
        VALUES (${user.id}, ${user.email}, ${visitorId})`;
    } catch (auditError) {
      console.error("[api/admin/visitor-intel] network audit unavailable", auditError);
      return Response.json({ error: "Network access audit unavailable" }, { status: 503 });
    }
    // An expanded row counts as having been reviewed by an admin.
    try {
      await updateWatchedViewedAt(visitorId);
    } catch {
      // fail-open — the panel still renders
    }
    return Response.json(intel, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (err) {
    console.error("[api/admin/visitor-intel] error:", err);
    return Response.json({ error: "Failed to load visitor intel" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/visitor-intel")({
  server: { handlers: { GET: handler } },
});
