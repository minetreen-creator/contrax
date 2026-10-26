import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { placeLabel } from "~/lib/live-console";
import { isLikelyScraper, medianGapSeconds, scraperSignals, type VisitorTrail } from "~/lib/scraper-watch";
import { ensureTrackedVisitorsTable } from "~/lib/scraper-watch.server";

/**
 * Scraper tracker (src/lib/scraper-watch.ts). Admin only.
 *
 * GET  /api/admin/track-visitor?vid=<id>   → the visitor's trail (VisitorTrail)
 * POST /api/admin/track-visitor { vid, action: "track" | "untrack", note? }
 *
 * Unlike "Watch visitor" there is no lead-score gate: the point is to keep an
 * eye on traffic that is NOT a lead. The trail includes the raw IP, so every
 * read is written to admin_network_access_audit like the Visitor Intel panel.
 */
async function admin(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return { user: null, error: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!user.is_admin) return { user: null, error: Response.json({ error: "Admin access required" }, { status: 403 }) };
  return { user, error: null };
}

function cleanVid(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= 64 ? s : "";
}

async function GET({ request }: { request: Request }) {
  const { user, error } = await admin(request);
  if (!user) return error;
  const vid = cleanVid(new URL(request.url).searchParams.get("vid"));
  if (!vid) return Response.json({ error: "vid is required" }, { status: 400 });
  const db = sql();
  try {
    await ensureTrackedVisitorsTable();
    const [v] = (await db`
      SELECT first_seen_at, last_seen_at, last_ip, city, region, country, device_type, browser_label
      FROM visitors WHERE visitor_id = ${vid}
    `) as {
      first_seen_at: string | null;
      last_seen_at: string | null;
      last_ip: string | null;
      city: string | null;
      region: string | null;
      country: string | null;
      device_type: string | null;
      browser_label: string | null;
    }[];
    const [agg] = (await db`
      SELECT COUNT(*)::int AS total,
             MIN(created_at) AS first_at,
             MAX(created_at) AS last_at,
             BOOL_OR(user_id IS NOT NULL) AS signed_in,
             (ARRAY_AGG(user_agent ORDER BY created_at DESC))[1] AS ua,
             (ARRAY_AGG(ip ORDER BY created_at DESC))[1] AS ip,
             (ARRAY_AGG(city ORDER BY created_at DESC))[1] AS city,
             (ARRAY_AGG(region ORDER BY created_at DESC))[1] AS region
      FROM page_views WHERE visitor_id = ${vid}
    `) as { total: number; first_at: string | null; last_at: string | null; signed_in: boolean | null; ua: string | null; ip: string | null; city: string | null; region: string | null }[];
    if (!v && !Number(agg?.total)) return Response.json({ error: "Visitor not found" }, { status: 404 });

    const hourRows = (await db`
      SELECT created_at FROM page_views
      WHERE visitor_id = ${vid} AND created_at > NOW() - INTERVAL '60 minutes'
      ORDER BY created_at ASC
    `) as { created_at: string }[];
    const pages = (await db`
      SELECT split_part(path, '?', 1) AS path, COUNT(*)::int AS views, MAX(created_at) AS last_at
      FROM page_views WHERE visitor_id = ${vid}
      GROUP BY 1 ORDER BY views DESC, last_at DESC LIMIT 15
    `) as { path: string; views: number; last_at: string }[];
    const [bids] = (await db`
      SELECT COUNT(DISTINCT split_part(path, '?', 1))::int AS n FROM page_views
      WHERE visitor_id = ${vid} AND created_at > NOW() - INTERVAL '60 minutes' AND path LIKE '/bid/%'
    `) as { n: number }[];

    let searches: VisitorTrail["searches"] = [];
    let searchesHour = 0;
    try {
      const rows = (await db`
        SELECT trade, state, matched, created_at FROM radar_search_log
        WHERE visitor_id = ${vid} ORDER BY created_at DESC LIMIT 10
      `) as { trade: string; state: string; matched: number; created_at: string }[];
      searches = rows.map((r) => ({ trade: r.trade, state: r.state, matched: Number(r.matched), at: new Date(r.created_at).toISOString() }));
      searchesHour = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() <= 3_600_000).length;
    } catch {
      // No searches saved yet.
    }

    const ip = agg?.ip ?? v?.last_ip ?? null;
    let sameIpVisitors = 0;
    if (ip) {
      const [n] = (await db`
        SELECT COUNT(DISTINCT visitor_id)::int AS n FROM page_views
        WHERE ip = ${ip} AND visitor_id IS NOT NULL AND visitor_id <> ${vid}
          AND created_at > NOW() - INTERVAL '24 hours'
      `) as { n: number }[];
      sameIpVisitors = Number(n?.n ?? 0);
    }

    const [t] = (await db`SELECT tracked_at, note FROM tracked_visitors WHERE visitor_id = ${vid}`) as { tracked_at: string; note: string | null }[];

    // Raw IP in the payload: record the access first, fail closed.
    try {
      await db`CREATE TABLE IF NOT EXISTS admin_network_access_audit (
        id BIGSERIAL PRIMARY KEY,
        admin_user_id INTEGER NOT NULL,
        admin_email TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await db`INSERT INTO admin_network_access_audit (admin_user_id, admin_email, visitor_id)
        VALUES (${user.id}, ${user.email}, ${vid})`;
    } catch (auditError) {
      console.error("[api/admin/track-visitor] network audit unavailable", auditError);
      return Response.json({ error: "Network access audit unavailable" }, { status: 503 });
    }

    const hitTimesHour = hourRows.map((r) => new Date(r.created_at).getTime());
    const signals = scraperSignals({
      country: v?.country ?? null,
      userAgent: agg?.ua ?? null,
      hitTimesHour,
      bidPagesHour: Number(bids?.n ?? 0),
      searchesHour,
      signedIn: !!agg?.signed_in,
      sameIpVisitors,
    });
    const iso = (x: string | null | undefined) => (x ? new Date(x).toISOString() : null);
    const trail: VisitorTrail = {
      vid,
      tracked: !!t,
      trackedAt: iso(t?.tracked_at),
      note: t?.note ?? null,
      place: placeLabel(agg?.city ?? v?.city, agg?.region ?? v?.region),
      country: v?.country ?? null,
      ip,
      browser: v?.browser_label ?? null,
      device: v?.device_type ?? null,
      userAgent: agg?.ua ? String(agg.ua).slice(0, 300) : null,
      firstSeen: iso(agg?.first_at ?? v?.first_seen_at),
      lastSeen: iso(agg?.last_at ?? v?.last_seen_at),
      viewsTotal: Number(agg?.total ?? 0),
      viewsHour: hitTimesHour.length,
      medianGap: medianGapSeconds(hitTimesHour),
      sameIpVisitors,
      pages: pages.map((p) => ({ path: String(p.path).slice(0, 80), views: Number(p.views), lastAt: new Date(p.last_at).toISOString() })),
      searches,
      signals,
      likelyScraper: isLikelyScraper(signals),
    };
    return Response.json(trail, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (err) {
    console.error("[api/admin/track-visitor] error:", err);
    return Response.json({ error: "Failed to load the visitor trail" }, { status: 500 });
  }
}

async function POST({ request }: { request: Request }) {
  const { user, error } = await admin(request);
  if (!user) return error;
  let body: { vid?: unknown; action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const vid = cleanVid(body.vid);
  if (!vid) return Response.json({ error: "vid is required" }, { status: 400 });
  if (body.action !== "track" && body.action !== "untrack") {
    return Response.json({ error: 'action must be "track" or "untrack"' }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  const db = sql();
  try {
    await ensureTrackedVisitorsTable();
    if (body.action === "track") {
      await db`INSERT INTO tracked_visitors (visitor_id, note) VALUES (${vid}, ${note})
        ON CONFLICT (visitor_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, tracked_visitors.note)`;
    } else {
      await db`DELETE FROM tracked_visitors WHERE visitor_id = ${vid}`;
    }
    return Response.json({ ok: true, vid, tracked: body.action === "track" });
  } catch (err) {
    console.error("[api/admin/track-visitor] write failed:", err);
    return Response.json({ error: "Could not save" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/track-visitor")({
  server: { handlers: { GET, POST } },
});
