import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import {
  RADAR_CONVERSION_FUNNEL_STAGES,
  RADAR_CONVERSION_QUALIFYING_EVENTS,
  RADAR_CONVERSION_START_EVENT,
  RADAR_CONVERSION_COMPLETE_EVENT,
  RADAR_CONVERSION_RESULTS_VIEWED_EVENT,
  RADAR_CONVERSION_UNLOCK_SHOWN_EVENT,
  RADAR_CONVERSION_UNLOCK_CLICKED_EVENT,
  RADAR_CONVERSION_SIGNUP_EVENT,
  RADAR_CONVERSION_ACTIVATION_EVENTS,
  RADAR_CONVERSION_INVOLVED_EVENTS,
  conversionDropOff,
  emptyRadarConversionFunnel,
} from "~/lib/radar-conversion-funnel";
/**
 * GET /api/admin/radar-conversion-funnel?days=N
 *
 * Admin-only 9-stage RADAR CONVERSION funnel (owner 2026-09-07 sprint, PR2):
 * Qualified Visit → Radar Started → Radar Completed → Results Viewed →
 * Unlock Shown → Unlock Clicked → Signup → Activated → Paid.
 *
 * NEW and SEPARATE from the existing 7-stage Radar-Leads funnel
 * (src/routes/api/admin/radar-leads-funnel.ts) and from the CEO unified funnel
 * (src/routes/api/admin/unified-funnel.ts — its definitions/numbers are NEVER
 * touched here). Stages 1–6 are per-event DISTINCT visitor counts over
 * EXISTING funnel events (PR1 added results/unlock events; NO analytics
 * rewrite). Stages 7–9 reuse existing events attributed to funnel-involved
 * visitors (radar-leads/autopsy attribution pattern — organic signups never
 * count). Paid derives from users.subscription_status = 'active' on accounts
 * whose visitor is conversion-funnel-involved.
 *
 * Counting: distinct visitors; consecutive drop-off; 0 when prior = 0. Same
 * bot/QA/admin exclusions as every admin surface. READ-ONLY (SELECTs only).
 */
const INVOLVED_EVENT_SQL = RADAR_CONVERSION_INVOLVED_EVENTS.map((e) => `'${e}'`).join(",");
const HUMAN_FILTER = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
    const url = new URL(request.url);
    const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400 * 1000);
    const fromIso = from.toISOString();
    const qaFilter = qaFunnelExclusionSQL("");
    const adminFilter = adminFunnelExclusionSQL("");
    const result = emptyRadarConversionFunnel(days);
    const counts: Record<string, number> = {};
    for (const s of RADAR_CONVERSION_FUNNEL_STAGES) counts[s.stage] = 0;
    // ── Stages 1–6: per-event distinct-visitor counts (EXISTING events) ─────
    try {
      const stageEvent: Record<string, readonly string[]> = {
        qualified: RADAR_CONVERSION_QUALIFYING_EVENTS,
        radar_started: [RADAR_CONVERSION_START_EVENT],
        radar_completed: [RADAR_CONVERSION_COMPLETE_EVENT],
        results_viewed: [RADAR_CONVERSION_RESULTS_VIEWED_EVENT],
        unlock_shown: [RADAR_CONVERSION_UNLOCK_SHOWN_EVENT],
        unlock_clicked: [RADAR_CONVERSION_UNLOCK_CLICKED_EVENT],
      };
      for (const [stage, events] of Object.entries(stageEvent)) {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id IS NOT NULL AND visitor_id <> ''
            AND created_at >= ${fromIso}
            AND event_name = ANY(${[...events]})
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        counts[stage] = Number(rows?.[0]?.n ?? 0);
      }
    } catch (err) {
      console.error("[api/admin/radar-conversion-funnel] stage counts failed (continuing):", err);
    }
    // ── Funnel-involved visitor set (attribution key for stages 7–9) ────────
    let funnelVids: string[] = [];
    try {
      const vids: any[] = await sql()`
        SELECT DISTINCT visitor_id AS vid FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name IN (${sql().unsafe(INVOLVED_EVENT_SQL)})
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
      funnelVids = vids.map((r) => String(r.vid)).filter(Boolean);
    } catch (err) {
      console.error("[api/admin/radar-conversion-funnel] funnel-visitor set failed (continuing):", err);
    }
    // ── Stage 7 — signup (REUSED signup_success, attributed to THIS funnel) ─
    // ── Stage 8 — activated (REUSED ACTIVATION_EVENTS, attributed) ──────────
    if (funnelVids.length > 0) {
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id = ANY(${funnelVids})
            AND event_name = ${RADAR_CONVERSION_SIGNUP_EVENT}
            AND created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        counts.signup = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/radar-conversion-funnel] attributed signup failed (continuing):", err);
      }
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id = ANY(${funnelVids})
            AND event_name = ANY(${[...RADAR_CONVERSION_ACTIVATION_EVENTS]})
            AND created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        counts.activated = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/radar-conversion-funnel] attributed activation failed (continuing):", err);
      }
    }
    // ── Stage 9 — paid: active-subscription accounts on involved visitors ───
    let paidCount = 0;
    if (funnelVids.length > 0) {
      try {
        const convertedIds: any[] = await sql()`
          SELECT DISTINCT v.converted_user_id AS uid
          FROM visitors v
          JOIN funnel_events fe ON fe.visitor_id = v.visitor_id
          WHERE v.converted_user_id IS NOT NULL AND v.converted_user_id <> ''
            AND fe.visitor_id = ANY(${funnelVids})
            AND fe.event_name IN (${sql().unsafe(INVOLVED_EVENT_SQL)})
            AND fe.created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        const uidNumbers = convertedIds
          .map((r) => Number(String(r.uid)))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (uidNumbers.length > 0) {
          const actives: any[] = await sql()`
            SELECT COUNT(*) AS n FROM users
            WHERE id = ANY(${uidNumbers})
              AND subscription_status = 'active'`;
          paidCount = Number(actives?.[0]?.n ?? 0);
        }
      } catch (err) {
        console.error("[api/admin/radar-conversion-funnel] paid count failed (continuing):", err);
      }
    }
    counts.paid = paidCount;
    // ── Consecutive drop-off (count vs previous stage; 0 when prior = 0) ────
    result.funnel = RADAR_CONVERSION_FUNNEL_STAGES.map((s, i) => {
      const prev = i === 0 ? null : counts[RADAR_CONVERSION_FUNNEL_STAGES[i - 1].stage];
      return { stage: s.stage, label: s.label, count: counts[s.stage] ?? 0, dropOffPct: conversionDropOff(counts[s.stage] ?? 0, prev) };
    });
    return Response.json({
      rangeDays: days,
      from: fromIso,
      to: now.toISOString(),
      funnel: result.funnel,
    });
  } catch (err) {
    console.error("[api/admin/radar-conversion-funnel] error:", err);
    return Response.json(emptyRadarConversionFunnel(30));
  }
}
export const Route = createFileRoute("/api/admin/radar-conversion-funnel")({
  server: { handlers: { GET: handler } },
});
