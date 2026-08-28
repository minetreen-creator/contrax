import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
/**
 * GET /api/admin/funnel-visitors?days=30
 *
 * Admin-only "Funnel per visitor" slice. Uses the persistent per-visitor
 * `visitor_id` (contrax_vid cookie) stamped onto every funnel_event row so we
 * can reconstruct a single visitor's journey across multiple steps — not just
 * aggregate event counts. For the chosen window it returns:
 *
 *   steps     — distinct human visitors who reached each funnel step name
 *               (hero_search → radar_scan_start → radar_scan_complete → signup_view → signup_success)
 *   funnel    — an ordered cumulative funnel (visitors reaching that stage OR later)
 *   sampleJourneys — a handful of full per-visitor event sequences (for QA /
 *               sanity-checking that the ids are actually stitching a journey).
 *
 * BOT FILTERING: every count applies the shared BOT_EXCLUSION_SQL predicate
 * (see src/lib/bot-exclusion.ts) so crawlers / headless QA / known test IPs are
 * excluded from the human numbers.
 *
 * Honest limitation: rows recorded before this feature shipped, and rows from
 * cookie/sessionStorage-blocked visitors, have NULL visitor_id and are simply
 * not counted here (they still exist in funnel_events). Missing tables on first
 * deploy → guarded, returns an empty structure rather than a 500.
 */
const STAGES = [
  "hero_search",
  "radar_scan_start",
  "radar_scan_complete",
  "signup_view",
  "signup_success",
] as const;
type Stage = (typeof STAGES)[number];

const HUMAN_FILTER = `AND NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;

interface FunnelVisitorsResult {
  rangeDays: number;
  from: string;
  to: string;
  steps: Record<Stage, number>;
  funnel: { stage: Stage; visitors: number }[];
  sampleJourneys: { visitor_id: string; events: string[] }[];
}

function emptyResult(rangeDays: number, now: Date, from: Date): FunnelVisitorsResult {
  const steps = {} as Record<Stage, number>;
  for (const s of STAGES) steps[s] = 0;
  return {
    rangeDays,
    from: from.toISOString(),
    to: now.toISOString(),
    steps,
    funnel: STAGES.map((stage) => ({ stage, visitors: 0 })),
    sampleJourneys: [],
  };
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
  const empty = emptyResult(rangeDays, now, from);
  try {
    // Distinct human visitors who reached each stage in the window.
    const stepRows = await Promise.all(
      STAGES.map((stage) =>
        sql()`SELECT COUNT(DISTINCT visitor_id)::int AS count
             FROM funnel_events
             WHERE event_name = ${stage}
               AND visitor_id IS NOT NULL AND visitor_id <> ''
               AND created_at >= ${from.toISOString()}
               ${sql().unsafe(HUMAN_FILTER)}`,
      ),
    );
    const steps = {} as Record<Stage, number>;
    STAGES.forEach((stage, i) => {
      steps[stage] = Number(stepRows[i][0]?.count ?? 0);
    });
    // Cumulative funnel: visitors reaching this stage or any later stage.
    const cumulativeRows = await Promise.all(
      STAGES.map((_stage, i) => {
        const later = STAGES.slice(i).map((s) => `'${s}'`).join(",");
        return sql()`SELECT COUNT(DISTINCT visitor_id)::int AS count
             FROM funnel_events
             WHERE event_name IN (
               ${sql().unsafe(later)}
             )
               AND visitor_id IS NOT NULL AND visitor_id <> ''
               AND created_at >= ${from.toISOString()}
               ${sql().unsafe(HUMAN_FILTER)}`;
      }),
    );
    const outFunnel = STAGES.map((stage, i) => ({
      stage,
      visitors: Number(cumulativeRows[i][0]?.count ?? 0),
    }));
    // A few full per-visitor journeys (ordered events), preferring the most
    // advanced visitors (those who reached signup_success). For QA / sanity —
    // samples are illustrative, so we don't bot-filter these (they're examples,
    // not headline counts).
    const journeyRows: any[] = await sql`
      SELECT visitor_id, array_agg(event_name ORDER BY created_at) AS events
      FROM funnel_events
      WHERE visitor_id IS NOT NULL AND visitor_id <> ''
        AND created_at >= ${from.toISOString()}
      GROUP BY visitor_id
      HAVING bool_or(event_name = 'signup_success')
      ORDER BY MAX(created_at) DESC
      LIMIT 5`;
    const sampleJourneys = (journeyRows as any[]).map((r) => ({
      visitor_id: r.visitor_id,
      events: (r.events as string[]) ?? [],
    }));
    return Response.json({
      rangeDays,
      from: from.toISOString(),
      to: now.toISOString(),
      steps,
      funnel: outFunnel,
      sampleJourneys,
    });
  } catch (err) {
    console.error("[api/admin/funnel-visitors] error:", err);
    return Response.json(empty);
  }
}
export const Route = createFileRoute("/api/admin/funnel-visitors")({
  server: { handlers: { GET: handler } },
});
