import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import {
  ACTIVATION_EVENTS,
  SIGNUP_VIEWED_EVENTS,
  SIGNUP_STARTED_EVENTS,
  RADAR_COMPLETE_EVENT,
} from "~/lib/tracking-intake";

/**
 * GET /api/admin/unified-funnel?days=N
 *
 * Admin-only "Unified Funnel" board (business-plan next step: the founder funnel
 * "Qualified visit → Radar completed → Signup completed → Activated → Paid").
 * Gives the owner one at-a-glance view of where QUALIFIED visitors drop, which is
 * the lead-gen bottleneck.
 *
 * STAGE DEFINITIONS (match the founder funnel already computed by Jarvis's signup
 * reader — src/lib/jarvis/readers.ts computeFunnelLines — and the Visitor Journeys
 * board's funnel; reused constants from tracking-intake.ts):
 *   1. qualified — any visitor who produced a qualifying intent signal: any of the
 *      ACTIVATION_EVENTS, radar_scan_complete, signup_view/signup_view_with_score,
 *      signup_start/signup_submit, signup_abandon, signup_success, hero_cta_click,
 *      radar_scan_start. (A visitor with at least one such funnel event.)
 *   2. radar     — visitor who ever fired radar_scan_complete.
 *   3. signup    — visitor who ever fired signup_success.
 *   4. activated — visitor who ever saw one of ACTIVATION_EVENTS.
 *   5. paid      — distinct funnel users linked to an account with
 *      subscription_status = 'active' (mirrors Jarvis + journeys 'paid' semantics).
 *
 * Stages are MONOTONIC by construction: the "qualified" event set is a superset of
 * the radar/signup/activated event sets, so a visitor counted at a later stage is
 * necessarily counted at every earlier stage.
 *
 * EVERY number re-applies the SAME exclusions the rest of the admin surface uses:
 * bot/crawler traffic via BOT_EXCLUSION_SQL, @test.contrax QA accounts via
 * qaFunnelExclusionSQL, and internal admin emails via adminFunnelExclusionSQL —
 * inlined into a single humanFilter fragment, identical to Jarvis.
 *
 * RESPONSE:
 *   rangeDays, from, to
 *   stages      — [{ stage, label, count, stepConversionPct }]; stepConversionPct
 *                 is the conversion % from the PREVIOUS stage (null when the
 *                 previous stage's denominator is 0, and null for the base
 *                 "qualified" stage). The UI renders '—' for null.
 *   bySource    — top N sources by qualified visitors (first qualifying-event
 *                 source per visitor, so the rows sum to the qualified total).
 *   byMedium    — top N mediums by qualified visitors (same first-touch approach).
 *
 * READ-ONLY: every statement is a SELECT. No migration, no writes.
 */

const QUALIFYING_EVENTS = [
  ...ACTIVATION_EVENTS,
  RADAR_COMPLETE_EVENT,
  ...SIGNUP_VIEWED_EVENTS,
  ...SIGNUP_STARTED_EVENTS,
  "signup_abandon",
  "signup_success",
  "hero_cta_click",
  "radar_scan_start",
];

const ACTIVATION = [...ACTIVATION_EVENTS];

const TOP_SOURCES = 8;

interface FunnelStage {
  stage: "qualified" | "radar" | "signup" | "activated" | "paid";
  label: string;
  count: number;
  /** Conversion % from the previous stage (null when the divisor is 0). */
  stepConversionPct: number | null;
}

interface UnifiedFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  stages: FunnelStage[];
  bySource: { source: string; count: number }[];
  byMedium: { medium: string; count: number }[];
}

function pct(n: number, d: number): number | null {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10; // one decimal
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
  const fromIso = from.toISOString();

  // Shared human/bot/QA/admin exclusion fragment — identical to Jarvis's
  // humanFilter. Inlined via sql().unsafe() into a WHERE ... AND ( ... ).
  const humanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)
    AND ${qaFunnelExclusionSQL("")} AND ${adminFunnelExclusionSQL("")}`;

  try {
    // Guard: if the funnel table doesn't exist yet (first deploy), degrade to an
    // honest empty structure rather than 500.
    const tableExists = await sql()`SELECT to_regclass('public.funnel_events') AS t`;
    if (!(tableExists[0] as any)?.t) {
      return Response.json({
        rangeDays,
        from: fromIso,
        to: now.toISOString(),
        stages: [
          { stage: "qualified", label: "Qualified visit", count: 0, stepConversionPct: null },
          { stage: "radar", label: "Radar completed", count: 0, stepConversionPct: null },
          { stage: "signup", label: "Signup completed", count: 0, stepConversionPct: null },
          { stage: "activated", label: "Activated", count: 0, stepConversionPct: null },
          { stage: "paid", label: "Paid", count: 0, stepConversionPct: null },
        ],
        bySource: [],
        byMedium: [],
      } satisfies UnifiedFunnelResult);
    }

    // Distinct visitors in-window who fired any event in the given set.
    const distinctVisitorsWith = async (events: readonly string[]): Promise<number> => {
      const rows = await sql()`
        SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name = ANY(${events})
          AND ${sql().unsafe(humanFilter)}`;
      return Number(rows[0]?.n ?? 0);
    };

    // Paid: distinct funnel users linked to an active-subscription account.
    // funnel_events.user_id is stored as TEXT, so compare against users.id as text
    // to avoid "integer = text" type errors (same as Jarvis).
    const paidRows = await sql()`
      SELECT COUNT(DISTINCT fe.user_id) AS n
      FROM funnel_events fe JOIN users u ON u.id::text = fe.user_id
      WHERE fe.user_id IS NOT NULL AND fe.user_id <> '' AND fe.created_at >= ${fromIso}
        AND u.subscription_status = 'active'
        AND ${sql().unsafe(humanFilter)}`;

    // Qualified-stage source/medium breakdown: per qualified visitor, use the
    // source of their EARLIEST qualifying event (first-touch among qualifying
    // events), so the breakdown rows sum to the qualified total.
    const [qualified, radar, signup, activated] = await Promise.all([
      distinctVisitorsWith(QUALIFYING_EVENTS),
      distinctVisitorsWith([RADAR_COMPLETE_EVENT]),
      distinctVisitorsWith(["signup_success"]),
      distinctVisitorsWith(ACTIVATION),
    ]);
    const paid = Number(paidRows[0]?.n ?? 0);

    const bySourceRows = await sql()`
      SELECT COALESCE(NULLIF(source,''),'direct') AS source, COUNT(*) AS n
      FROM (
        SELECT DISTINCT ON (visitor_id) visitor_id, source
        FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name = ANY(${QUALIFYING_EVENTS})
          AND ${sql().unsafe(humanFilter)}
        ORDER BY visitor_id, created_at ASC
      ) t
      GROUP BY 1 ORDER BY n DESC, source ASC LIMIT ${TOP_SOURCES}`;

    const byMediumRows = await sql()`
      SELECT COALESCE(NULLIF(medium,''),'(none)') AS medium, COUNT(*) AS n
      FROM (
        SELECT DISTINCT ON (visitor_id) visitor_id, medium
        FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name = ANY(${QUALIFYING_EVENTS})
          AND ${sql().unsafe(humanFilter)}
        ORDER BY visitor_id, created_at ASC
      ) t
      GROUP BY 1 ORDER BY n DESC, medium ASC LIMIT ${TOP_SOURCES}`;

    const stages: FunnelStage[] = [
      { stage: "qualified", label: "Qualified visit", count: qualified, stepConversionPct: null },
      { stage: "radar", label: "Radar completed", count: radar, stepConversionPct: pct(radar, qualified) },
      { stage: "signup", label: "Signup completed", count: signup, stepConversionPct: pct(signup, radar) },
      { stage: "activated", label: "Activated", count: activated, stepConversionPct: pct(activated, signup) },
      { stage: "paid", label: "Paid", count: paid, stepConversionPct: pct(paid, activated) },
    ];

    return Response.json({
      rangeDays,
      from: fromIso,
      to: now.toISOString(),
      stages,
      bySource: (bySourceRows as any[]).map((r) => ({ source: String(r.source), count: Number(r.n) })),
      byMedium: (byMediumRows as any[]).map((r) => ({ medium: String(r.medium), count: Number(r.n) })),
    } satisfies UnifiedFunnelResult);
  } catch (err) {
    console.error("[api/admin/unified-funnel] error:", err);
    return Response.json({ error: "Failed to load unified funnel" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/unified-funnel")({
  server: { handlers: { GET: handler } },
});
