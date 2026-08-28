import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
/**
 * GET /api/admin/funnel-visitors?days=30[&source=facebook]
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
 * OPTIONAL `source` param: when present (e.g. `?days=30&source=facebook`) the
 * step counts, cumulative funnel, sampleJourneys AND the new `conversionGoal`
 * object are all eager-filtered to funnel_events whose `source` column equals
 * the given value (added to each WHERE, not post-filtered). `conversionGoal`
 * (`goal: 'radar_scan_to_signup'`) makes the radar→signup paid-channel goal
 * legible: distinct visitors who reached radar_scan_complete, who then reached
 * signup_view after their radar_scan_complete, who reached signup_success, and
 * the two stepwise conversion rates. When `source` is absent the endpoint is
 * byte-for-byte unchanged from the un-filtered default (and no `conversionGoal`
 * key is returned at all) so existing callers are unaffected.
 *
 * BOT FILTERING: every human count applies the shared BOT_EXCLUSION_SQL
 * predicate (see src/lib/bot-exclusion.ts) so crawlers / headless QA / known
 * test IPs are excluded from the human numbers. In the self-join conversionGoal
 * query each level only has one table alias in scope, so the same unqualified
 * predicate resolves to that level's row (outer → signup_view 's', inner →
 * radar_scan_complete 'r').
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

interface ConversionGoal {
  goal: "radar_scan_to_signup";
  source: string;
  radarComplete: number;
  signupViewAfterRadar: number;
  signupSuccess: number;
  radarToSignupViewRate: number;
  radarToSignupSuccessRate: number;
}

interface FunnelVisitorsResult {
  rangeDays: number;
  from: string;
  to: string;
  steps: Record<Stage, number>;
  funnel: { stage: Stage; visitors: number }[];
  sampleJourneys: { visitor_id: string; events: string[] }[];
  conversionGoal?: ConversionGoal;
}

/** Percentage rounded to 1 decimal place; 0.0 when the denominator is 0. */
function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function emptyConversionGoal(source: string): ConversionGoal {
  return {
    goal: "radar_scan_to_signup",
    source,
    radarComplete: 0,
    signupViewAfterRadar: 0,
    signupSuccess: 0,
    radarToSignupViewRate: 0,
    radarToSignupSuccessRate: 0,
  };
}

function emptyResult(
  rangeDays: number,
  now: Date,
  from: Date,
  source: string | null,
): FunnelVisitorsResult {
  const steps = {} as Record<Stage, number>;
  for (const s of STAGES) steps[s] = 0;
  const result: FunnelVisitorsResult = {
    rangeDays,
    from: from.toISOString(),
    to: now.toISOString(),
    steps,
    funnel: STAGES.map((stage) => ({ stage, visitors: 0 })),
    sampleJourneys: [],
  };
  if (source !== null) result.conversionGoal = emptyConversionGoal(source);
  return result;
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
  // Optional `source` filter — trimmed, capped at 64 chars, only activates when
  // non-empty. When absent, behavior is byte-for-byte unchanged from today.
  const sourceParam = (url.searchParams.get("source") || "").trim();
  const source = sourceParam.length > 0 ? sourceParam.slice(0, 64) : null;
  // Empty-fragment when source is null; `AND source = $n` when active. Added to
  // the WHERE of every query so filtering is eager, not post-hoc.
  const sourceFilter = source === null ? sql`` : sql`AND source = ${source}`;
  const empty = emptyResult(rangeDays, now, from, source);
  try {
    // Distinct human visitors who reached each stage in the window.
    const stepRows = await Promise.all(
      STAGES.map((stage) =>
        sql()`SELECT COUNT(DISTINCT visitor_id)::int AS count
             FROM funnel_events
             WHERE event_name = ${stage}
               AND visitor_id IS NOT NULL AND visitor_id <> ''
               AND created_at >= ${from.toISOString()}
               ${sourceFilter}
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
               ${sourceFilter}
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
        ${sourceFilter}
      GROUP BY visitor_id
      HAVING bool_or(event_name = 'signup_success')
      ORDER BY MAX(created_at) DESC
      LIMIT 5`;
    const sampleJourneys = (journeyRows as any[]).map((r) => ({
      visitor_id: r.visitor_id,
      events: (r.events as string[]) ?? [],
    }));

    // Radar → signup conversion goal for the source-filtered window.
    let conversionGoal: ConversionGoal | undefined;
    if (source !== null) {
      // (a) Distinct human visitors who reached radar_scan_complete.
      const radarRows: any[] = await sql`
        SELECT COUNT(DISTINCT visitor_id)::int AS count
        FROM funnel_events
        WHERE event_name = 'radar_scan_complete'
          AND visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${from.toISOString()}
          ${sourceFilter}
          ${sql().unsafe(HUMAN_FILTER)}`;
      // (b) Distinct human visitors who reached signup_view AFTER they had
      // reached radar_scan_complete (same visitor_id, signup_view created_at >=
      // that visitor's radar_scan_complete created_at). Both sides of the
      // self-join are source- and bot-filtered (the unqualified BOT_EXCLUSION_SQL
      // resolves to the single in-scope alias at each level).
      const viewAfterRows: any[] = await sql`
        SELECT COUNT(DISTINCT s.visitor_id)::int AS count
        FROM funnel_events s
        WHERE s.event_name = 'signup_view'
          AND s.visitor_id IS NOT NULL AND s.visitor_id <> ''
          AND s.created_at >= ${from.toISOString()}
          AND s.source = ${source}
          ${sql().unsafe(HUMAN_FILTER)}
          AND EXISTS (
            SELECT 1 FROM funnel_events r
            WHERE r.visitor_id = s.visitor_id
              AND r.event_name = 'radar_scan_complete'
              AND r.visitor_id IS NOT NULL AND r.visitor_id <> ''
              AND r.created_at >= ${from.toISOString()}
              AND r.created_at <= s.created_at
              AND r.source = ${source}
              ${sql().unsafe(HUMAN_FILTER)}
          )`;
      // (c) Distinct human visitors who reached signup_success.
      const successRows: any[] = await sql`
        SELECT COUNT(DISTINCT visitor_id)::int AS count
        FROM funnel_events
        WHERE event_name = 'signup_success'
          AND visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${from.toISOString()}
          ${sourceFilter}
          ${sql().unsafe(HUMAN_FILTER)}`;
      const radarComplete = Number(radarRows[0]?.count ?? 0);
      const signupViewAfterRadar = Number(viewAfterRows[0]?.count ?? 0);
      const signupSuccess = Number(successRows[0]?.count ?? 0);
      conversionGoal = {
        goal: "radar_scan_to_signup",
        source,
        radarComplete,
        signupViewAfterRadar,
        signupSuccess,
        radarToSignupViewRate: pct(signupViewAfterRadar, radarComplete),
        radarToSignupSuccessRate: pct(signupSuccess, radarComplete),
      };
    }

    const result: FunnelVisitorsResult = {
      rangeDays,
      from: from.toISOString(),
      to: now.toISOString(),
      steps,
      funnel: outFunnel,
      sampleJourneys,
    };
    if (conversionGoal) result.conversionGoal = conversionGoal;
    return Response.json(result);
  } catch (err) {
    console.error("[api/admin/funnel-visitors] error:", err);
    return Response.json(empty);
  }
}
export const Route = createFileRoute("/api/admin/funnel-visitors")({
  server: { handlers: { GET: handler } },
});
