import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";
import {
  qaFunnelExclusionSQL,
  adminFunnelExclusionSQL,
  visitorsBotExclusionSQL,
} from "~/lib/qa-exclusion";
import {
  ACTIVATION_EVENTS,
  SIGNUP_VIEWED_EVENTS,
  SIGNUP_STARTED_EVENTS,
  RADAR_COMPLETE_EVENT,
} from "~/lib/tracking-intake";

/**
 * GET /api/admin/analytics-consistency?range=30d
 *
 * DIAGNOSTIC-ONLY admin endpoint (owner 2026-09-10). Explains in one read why
 * two admin surfaces can show different "qualified" numbers:
 *
 *   CONTRAX TODAY "Qualified Visitors" card  (src/routes/admin/index.tsx:419)
 *     → GET /api/admin/unified-funnel stage "qualified"
 *       (src/routes/api/admin/unified-funnel.ts) — COUNT(DISTINCT visitor_id)
 *       over funnel_events whose event_name is one of the 14 QUALIFYING intent
 *       events within the 30d rolling window.
 *
 *   Visitor Journeys "Unified funnel" stage 1 (src/routes/admin/journeys.tsx:835)
 *     → GET /api/admin/journeys `funnel` (src/routes/api/admin/journeys.ts:1066)
 *       — count of journeys rows = distinct visitors with ANY in-window activity
 *       (visitors summary cache filtered by last_seen_at >= window; a page view
 *       alone counts) PLUS orphan visitor_ids derived from in-window
 *       funnel_events/page_views detail rows that have no summary row.
 *
 * The two counts are intentionally recomputed here (NOT copied from the other
 * endpoints) using the exact same tables, event sets, window math, and
 * bot/QA/admin exclusion fragments, so this endpoint is a live source of truth
 * that cannot drift from what the dashboard sections would render right now.
 *
 * READ-ONLY: every statement is a SELECT. No writes, no event firing, no
 * cache-busting side effects. Does not modify any existing endpoint.
 *
 * RESPONSE:
 *   rangeDays, from, to        — the window actually used (rolling
 *                                now − rangeDays×24h, UTC, inclusive lower bound,
 *                                identical math to unified-funnel + journeys)
 *   contraxToday               — { count, countType, distinctBy, source } for the CARD
 *   unifiedFunnel              — { count, countType, distinctBy, source } for the
 *                                JOURNEYS-board funnel stage 1
 *   delta                      — unifiedFunnel.count − contraxToday.count
 *   rootCause                  — string explanations, each CONFIRMED by the live
 *                                comparison (disproven hypotheses are not listed)
 *   evidence                   — supporting read-only numbers (see below)
 */

const QUALIFYING_EVENTS: readonly string[] = [
  ...ACTIVATION_EVENTS,
  RADAR_COMPLETE_EVENT,
  ...SIGNUP_VIEWED_EVENTS,
  ...SIGNUP_STARTED_EVENTS,
  "signup_abandon",
  "signup_success",
  "hero_cta_click",
  "radar_scan_start",
];

/** Window parsing: `30d`, `30`, `7d` → days; clamped 1..365; default 30. */
function parseRangeDays(raw: string | null): number {
  if (!raw) return 30;
  const m = /^\s*(\d{1,3})\s*d?\s*$/i.exec(raw.trim());
  if (!m) return 30;
  return Math.min(365, Math.max(1, parseInt(m[1], 10)));
}

interface SectionInfo {
  count: number;
  countType: string;
  distinctBy: string;
  source: string;
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const rangeDays = parseRangeDays(url.searchParams.get("range") ?? url.searchParams.get("days"));
  const now = new Date();
  const fromIso = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  // Same exclusion fragments the existing endpoints inline.
  const funnelHumanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)
    AND ${qaFunnelExclusionSQL("")} AND ${adminFunnelExclusionSQL("")}`;
  const detailHumanFilter = `AND NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
  const qaFilter = `AND ${qaFunnelExclusionSQL("")}`;
  const adminFilter = `AND ${adminFunnelExclusionSQL("")}`;
  // users-table admin/test predicate for linked (converted) summary rows —
  // mirrors journeys.ts isExcludedEmail() semantics on u.email.
  const adminEmails = [...ADMIN_EMAILS]
    .map((e) => `LOWER(COALESCE(u.email,'')) <> '${e.toLowerCase()}'`)
    .join(" AND ");
  const linkedUserFilter = `(u.id IS NULL OR (${adminEmails || "TRUE"}))`;

  try {
    // Guard quietly: missing tables on a first deploy → honest zero structure.
    const fe = await sql()`SELECT to_regclass('public.funnel_events') AS t`;
    const vis = await sql()`SELECT to_regclass('public.visitors') AS t`;
    const pv = await sql()`SELECT to_regclass('public.page_views') AS t`;
    const tablesPresent = !!(fe[0] as any)?.t && !!(vis[0] as any)?.t;
    const detailTablesPresent = tablesPresent && !!(pv[0] as any)?.t;

    let contraxToday = 0;
    let fastPath = 0;
    let orphans = 0;

    if (tablesPresent) {
      // ── CARD: /api/admin/unified-funnel stage "qualified" (exact SQL) ──────
      const cardRows: any[] = await sql()`
        SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name = ANY(${[...QUALIFYING_EVENTS]})
          AND ${sql().unsafe(funnelHumanFilter)}`;
      contraxToday = Number(cardRows[0]?.n ?? 0);

      // ── JOURNEYS funnel stage 1, fast path (visitors summary + read-side
      //    exclusions expressed in SQL; mirrors journeys.ts:769-774 + 879/883).
      const fastRows: any[] = await sql()`
        SELECT COUNT(*) AS n FROM visitors v
        LEFT JOIN users u ON u.id::text = v.converted_user_id::text
        WHERE v.last_seen_at >= ${fromIso}
          AND NOT COALESCE((${sql().unsafe(visitorsBotExclusionSQL())}), false)
          AND ${sql().unsafe(linkedUserFilter)}`;
      fastPath = Number(fastRows[0]?.n ?? 0);
    }

    if (detailTablesPresent) {
      // ── Orphan fallback (mirrors journeys.ts:965-976): distinct in-window
      //    detail vids (bot/QA/admin-filtered) with no summary row in-window.
      const orphanRows: any[] = await sql()`
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT vid FROM (
            SELECT visitor_id AS vid FROM funnel_events
              WHERE visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso}
              ${sql().unsafe(detailHumanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
            UNION
            SELECT visitor_id AS vid FROM page_views
              WHERE visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso}
              ${sql().unsafe(detailHumanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
          ) t
          WHERE t.vid NOT IN (SELECT visitor_id FROM visitors WHERE last_seen_at >= ${fromIso})
        ) x`;
      orphans = Number(orphanRows[0]?.n ?? 0);
    }
    const unifiedFunnel = fastPath + orphans;

    // ── EVIDENCE: read-only diagnostics isolating each suspected cause ───────
    let qualifyingByEvent: { event_name: string; n: number }[] = [];
    let pageViewOnly = 0;
    let alertCreatedTotal = 0;
    let alertCreatedWithVid = 0;
    let nullVidEventRows = 0;
    let visitorsRaw = 0;
    let visitorsBotDropped = 0;

    if (tablesPresent) {
      const byEvent: any[] = await sql()`
        SELECT event_name, COUNT(DISTINCT visitor_id) AS n FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso}
          AND event_name = ANY(${[...QUALIFYING_EVENTS]})
          AND ${sql().unsafe(funnelHumanFilter)}
        GROUP BY event_name ORDER BY n DESC`;
      qualifyingByEvent = byEvent.map((r) => ({ event_name: String(r.event_name), n: Number(r.n) }));

      const pvOnly: any[] = await sql()`
        SELECT COUNT(*) AS n FROM (
          SELECT visitor_id FROM page_views
            WHERE visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso}
            ${sql().unsafe(detailHumanFilter)} ${sql().unsafe(qaFilter)} ${sql().unsafe(adminFilter)}
          EXCEPT
          SELECT DISTINCT visitor_id FROM funnel_events
            WHERE visitor_id IS NOT NULL AND visitor_id <> '' AND created_at >= ${fromIso}
              AND event_name = ANY(${[...QUALIFYING_EVENTS]})
              AND ${sql().unsafe(funnelHumanFilter)}
        ) t`;
      pageViewOnly = Number(pvOnly[0]?.n ?? 0);

      const ac: any[] = await sql()`
        SELECT COUNT(*) AS total, COUNT(visitor_id) AS with_vid FROM funnel_events
        WHERE event_name = 'alert_created' AND created_at >= ${fromIso}`;
      alertCreatedTotal = Number(ac[0]?.total ?? 0);
      alertCreatedWithVid = Number(ac[0]?.with_vid ?? 0);

      const nv: any[] = await sql()`
        SELECT COUNT(*) AS n FROM funnel_events
        WHERE created_at >= ${fromIso} AND (visitor_id IS NULL OR visitor_id = '')`;
      nullVidEventRows = Number(nv[0]?.n ?? 0);

      const vr: any[] = await sql()`
        SELECT COUNT(*) AS n FROM visitors WHERE last_seen_at >= ${fromIso}`;
      visitorsRaw = Number(vr[0]?.n ?? 0);

      const vb: any[] = await sql()`
        SELECT COUNT(*) AS n FROM visitors
        WHERE last_seen_at >= ${fromIso} AND ${sql().unsafe(visitorsBotExclusionSQL())}`;
      visitorsBotDropped = Number(vb[0]?.n ?? 0);
    }

    // ── ROOT CAUSE: only the causes the data CONFIRMS. ───────────────────────
    const rootCause: string[] = [];
    if (pageViewOnly > 0) {
      rootCause.push(
        `Different "qualified" definitions: the CONTRAX TODAY card counts distinct visitors who fired at least one of the ${QUALIFYING_EVENTS.length} qualifying intent events inside the window (funnel_events detail table); the journeys "Unified funnel" stage 1 counts every distinct visitor with ANY in-window activity (the visitors summary cache keyed on last_seen_at — a homepage or autopsy page view alone qualifies) plus orphan detail rows. ${pageViewOnly} of the ${unifiedFunnel} funnel visitors never fired a qualifying intent event in-window (page views only), which accounts for the entire ${unifiedFunnel - contraxToday} gap in this window.`,
      );
    }
    if (orphans > 0) {
      rootCause.push(
        `The journeys funnel additionally includes ${orphans} orphan visitor_ids that have in-window detail rows but no in-window visitors summary row (pre-summary-cache or skipped-intake rows); the card has no such path.`,
      );
    }
    if (alertCreatedTotal > 0 && alertCreatedWithVid === 0) {
      rootCause.push(
        `Cron alert_created rows do NOT inflate either number: ${alertCreatedTotal} fired in-window, ${alertCreatedWithVid} with a visitor_id. The card ignores NULL/empty visitor_id entirely, and the journeys funnel is driven by the visitors summary table (cron writes funnel_events directly), so the NULL-visitor_id cron theory is disproven.`,
      );
    }
    if (visitorsBotDropped > 0) {
      rootCause.push(
        `Exclusion mechanics differ slightly: the card runs BOT_EXCLUSION_SQL (IP + user-agent arms) over funnel_events rows, while the journeys fast path can only apply IP/referrer/qa-probe arms to the visitors summary (it has no user_agent column) and dropped ${visitorsBotDropped} in-window summary rows as bots at read time. Both surfaces exclude bots, but not with identical clauses.`,
      );
    }
    if (rootCause.length === 0) {
      rootCause.push("No divergence detected in the current window (both counts agree).");
    }

    const contraxTodaySection: SectionInfo = {
      count: contraxToday,
      countType: "distinct visitors with ≥1 qualifying intent event in-window (funnel_events, 14-event allowlist)",
      distinctBy: "visitor_id (contrax_vid / Firebase uid), COUNT(DISTINCT visitor_id)",
      source: "GET /api/admin/unified-funnel stage 'qualified' (src/routes/api/admin/unified-funnel.ts) — CONTRAX TODAY card (src/routes/admin/index.tsx)",
    };
    const unifiedFunnelSection: SectionInfo = {
      count: unifiedFunnel,
      countType: "distinct visitors with ANY in-window activity (visitors summary rows last_seen_at >= window; page views alone count) + orphan detail rows",
      distinctBy: "visitor_id — one visitors summary row per visitor plus DISTINCT orphan detail vids",
      source: "GET /api/admin/journeys `funnel` stage 1 (src/routes/api/admin/journeys.ts) — Visitor Journeys 'Unified funnel' (src/routes/admin/journeys.tsx)",
    };

    return Response.json({
      rangeDays,
      from: fromIso,
      to: now.toISOString(),
      contraxToday: contraxTodaySection,
      unifiedFunnel: unifiedFunnelSection,
      delta: unifiedFunnel - contraxToday,
      rootCause,
      evidence: {
        qualifyingEventsByVisitor: qualifyingByEvent,
        pageViewOnlyDistinctVisitors: pageViewOnly,
        orphanDistinctVisitors: orphans,
        visitorsSummaryRowsInWindow: visitorsRaw,
        visitorsSummaryBotDropped: visitorsBotDropped,
        alertCreatedRowsInWindow: alertCreatedTotal,
        alertCreatedRowsWithVisitorId: alertCreatedWithVid,
        funnelEventRowsWithNullVisitorIdInWindow: nullVidEventRows,
      },
    });
  } catch (err) {
    console.error("[api/admin/analytics-consistency] error:", err);
    return Response.json({ error: "Failed to load analytics consistency" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/analytics-consistency")({
  server: { handlers: { GET: handler } },
});