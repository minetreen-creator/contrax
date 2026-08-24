import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";

/**
 * GET /api/admin/acquisition?days=30
 *
 * Admin-only "Acquisition by Source" slice: for the chosen window, group
 * visitors by their first-touch attribution source+medium and show
 *   visits → signup-views → signup-conversions.
 *
 * Attribution source/medium come from the `contrax_attr` cookie (or the
 * query/referer fallback) stamped onto every page_views and funnel_events row
 * by PR #214. See src/lib/attribution.ts.
 *
 * BOT FILTERING: the visits / signup-view / signup-conversion counts apply the
 * SAME BOT_EXCLUSION_SQL predicate that PR #210 uses for `uniqueHumanVisitorsToday`
 * (shared constant in src/lib/bot-exclusion.ts), so Meta's facebookexternalhit
 * link-unfurlers and other scrapers are EXCLUDED from the human numbers. The raw
 * (unfiltered) visit count is returned alongside for honesty, and the UI shows a
 * "filtered: …" note.
 *
 * Funnel steps mapped:
 *   views     = signup_view | signup_view_with_score (cold /signup + score-rec path)
 *   converts  = signup_success
 *
 * No data for the range (or missing tables on the very first deploy) → guarded,
 * returns an empty structure rather than a 500.
 */

const VIEW_EVENTS_SQL = "('signup_view','signup_view_with_score')";

interface AcquisitionRow {
  source: string;
  medium: string;
  visits: number;
  visitsRaw: number;
  signupViews: number;
  signupConversions: number;
}

export interface AcquisitionResult {
  rangeDays: number;
  from: string;
  to: string;
  rows: AcquisitionRow[];
  totals: {
    visits: number;
    visitsRaw: number;
    signupViews: number;
    signupConversions: number;
  };
}

function emptyResult(rangeDays: number, now: Date, from: Date): AcquisitionResult {
  return {
    rangeDays,
    from: from.toISOString(),
    to: now.toISOString(),
    rows: [],
    totals: { visits: 0, visitsRaw: 0, signupViews: 0, signupConversions: 0 },
  };
}

interface CountRow {
  source: string | null;
  medium: string | null;
  count: number;
}

function toMap(rows: CountRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.source ?? "direct"}|${r.medium ?? "(none)"}`;
    m.set(key, Number(r.count));
  }
  return m;
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get("days") || "30", 10);
  const rangeDays = Number.isFinite(daysParam) ? Math.min(365, Math.max(1, daysParam)) : 30;
  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const fromSql = from.toISOString();

  try {
    // Guard missing tables on first deploy.
    const pv = await sql()`SELECT to_regclass('public.page_views') AS t`;
    const fe = await sql()`SELECT to_regclass('public.funnel_events') AS t`;
    if (!(pv[0] as any)?.t || !(fe[0] as any)?.t) {
      return Response.json(emptyResult(rangeDays, now, from));
    }
    const notBot = `NOT COALESCE(${BOT_EXCLUSION_SQL}, false)`; // raw SQL predicate, see bot-exclusion.ts

    const [humanVisitsRows, rawVisitsRows, viewRows, convRows] = await Promise.all([
      sql()`SELECT source, medium, COUNT(*) AS count
            FROM page_views
            WHERE created_at >= ${fromSql} AND ${sql().unsafe(notBot)}
            GROUP BY source, medium`,
      sql()`SELECT source, medium, COUNT(*) AS count
            FROM page_views
            WHERE created_at >= ${fromSql}
            GROUP BY source, medium`,
      sql()`SELECT source, medium, COUNT(*) AS count
            FROM funnel_events
            WHERE created_at >= ${fromSql} AND event_name IN ${sql().unsafe(VIEW_EVENTS_SQL)} AND ${sql().unsafe(notBot)}
            GROUP BY source, medium`,
      sql()`SELECT source, medium, COUNT(*) AS count
            FROM funnel_events
            WHERE created_at >= ${fromSql} AND event_name = 'signup_success' AND ${sql().unsafe(notBot)}
            GROUP BY source, medium`,
    ]);

    const humanVisits = toMap(humanVisitsRows as CountRow[]);
    const rawVisits = toMap(rawVisitsRows as CountRow[]);
    const views = toMap(viewRows as CountRow[]);
    const convs = toMap(convRows as CountRow[]);

    const keys = new Set<string>([
      ...humanVisits.keys(),
      ...rawVisits.keys(),
      ...views.keys(),
      ...convs.keys(),
    ]);

    const rows: AcquisitionRow[] = [];
    for (const key of keys) {
      const [source, medium] = key.split("|");
      const row: AcquisitionRow = {
        source,
        medium,
        visits: humanVisits.get(key) ?? 0,
        visitsRaw: rawVisits.get(key) ?? 0,
        signupViews: views.get(key) ?? 0,
        signupConversions: convs.get(key) ?? 0,
      };
      rows.push(row);
    }
    // Sort by human visits (then by source) so the highest-value sources lead.
    rows.sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source));

    const totals = {
      visits: rows.reduce((s, r) => s + r.visits, 0),
      visitsRaw: rows.reduce((s, r) => s + r.visitsRaw, 0),
      signupViews: rows.reduce((s, r) => s + r.signupViews, 0),
      signupConversions: rows.reduce((s, r) => s + r.signupConversions, 0),
    };

    return Response.json({
      rangeDays,
      from: fromSql,
      to: now.toISOString(),
      rows,
      totals,
    });
  } catch (err) {
    console.error("[api/admin/acquisition] error:", err);
    return Response.json({ error: "Failed to load acquisition metrics" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/acquisition")({
  server: { handlers: { GET: handler } },
});
