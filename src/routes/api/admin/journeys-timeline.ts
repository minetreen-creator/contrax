import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { EVENT_LABELS } from "~/lib/tracking-intake";

/**
 * GET /api/admin/journeys-timeline?visitor_id=<id>
 *
 * Lazy, per-expanded-row timeline fetch for the admin "Visitor Journeys" board
 * (PR #2xx). The board list now comes from the `visitors` SUMMARY cache (fast
 * read-path); the detailed timeline STAYS in funnel_events + page_views and is
 * read HERE only when an admin expands a row — never for the whole board up
 * front.
 *
 * Returns the FULL historical journey for the given visitor_id (all time), each
 * item masked to { t, label, kind } — the same PII-safe shape the board's inline
 * timeline used to carry. The same bot / @test.contrax / ADMIN_EMAILS exclusions
 * are applied so expanded rows never leak QA/admin/test/bot activity.
 *
 * Auth: admin only.
 */
interface TimelineItem { t: string; label: string; kind: "page" | "event"; }

function pageLabel(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return "Homepage viewed";
  return `Viewed ${clean}`;
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const visitorId = url.searchParams.get("visitor_id");
  if (!visitorId || visitorId.length > 64) {
    return Response.json({ error: "visitor_id is required" }, { status: 400 });
  }

  const humanFilter = `AND NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = `AND ${qaFunnelExclusionSQL("")}`;
  const adminFilter = `AND ${adminFunnelExclusionSQL("")}`;

  try {
    try {
      await sql()`SELECT 1 FROM page_views LIMIT 1`;
      await sql()`SELECT 1 FROM funnel_events LIMIT 1`;
    } catch {
      return Response.json({ visitor_id: visitorId, events: [] });
    }

    const pageRows: any[] = await sql()`
      SELECT created_at, path FROM page_views
      WHERE visitor_id = ${visitorId} AND visitor_id <> ''
        ${sql().unsafe(humanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
      ORDER BY created_at ASC`;
    const eventRows: any[] = await sql()`
      SELECT created_at, event_name FROM funnel_events
      WHERE visitor_id = ${visitorId} AND visitor_id <> ''
        ${sql().unsafe(humanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
      ORDER BY created_at ASC`;

    const events: TimelineItem[] = [];
    for (const r of pageRows) {
      events.push({
        t: new Date(r.created_at).toISOString(),
        label: r.path === "/" ? "Homepage viewed" : pageLabel(r.path),
        kind: "page",
      });
    }
    for (const r of eventRows) {
      events.push({
        t: new Date(r.created_at).toISOString(),
        label:
          EVENT_LABELS[r.event_name] ??
          r.event_name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        kind: "event",
      });
    }
    events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

    return Response.json({ visitor_id: visitorId, events });
  } catch (err) {
    console.error("[api/admin/journeys-timeline] error:", err);
    return Response.json({ visitor_id: visitorId, events: [] });
  }
}

export const Route = createFileRoute("/api/admin/journeys-timeline")({
  server: { handlers: { GET: handler } },
});
