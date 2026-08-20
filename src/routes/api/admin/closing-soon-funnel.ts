import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

/**
 * GET /api/admin/closing-soon-funnel?days=30
 *
 * Admin-only funnel-measurement for the homepage "Closing Soon" section
 * (⏰ Closing in the next 7 days) → signup conversion.
 *
 * WHY THIS EXISTS: funnel_events has NO session_id / user_id, so an
 * individual's progression from a Closing Soon CTA click to a signup cannot be
 * linked exactly. The existing analytics stack already relies on the
 * (ip + user_agent + created_at) triple as its de-facto visitor identity, so
 * this endpoint uses the SAME heuristic: a "visitor" is the (ip, user_agent)
 * pair, and a downstream step is attributed to a Closing Soon click when that
 * visitor produced both the click and the downstream event, with the
 * downstream event occurring after the click and within SESSION_WINDOW_HOURS
 * (an approximate "session"). The numbers are APPROXIMATE attribution — never
 * an exact per-session count. The UI must label them as such.
 *
 * The funnel steps captured:
 *   click    = signup_cta_click, label=home_closing_soon
 *   view     = signup_view | signup_view_with_score  (see caveat below)
 *   submit   = signup_submit
 *   success  = signup_success
 *
 * CAVEAT (view step): the cold /signup path only started firing a plain
 * `signup_view` event when PR #180 landed; before that only
 * `signup_view_with_score` (the score-rec path) produced a view event. So the
 * view step will read 0 for Closing Soon path visitors until new cold-visit
 * view events accumulate. This is an honest instrumentation gap, not missing
 * signups.
 *
 * CAVEAT (button vs per-row): both the Closing Soon CTA button AND the per-row
 * title deep-links fire the IDENTICAL event (signup_cta_click,
 * label=home_closing_soon, path=/#closing-soon). They therefore cannot be
 * distinguished — this endpoint surfaces the aggregate only. Separating the
 * two would require adding a `label` dimension (e.g. an explicit
 * label=home_closing_soon_row vs =home_closing_soon_button), which is a
 * future instrumentation change, not possible retroactively.
 *
 * No data for the range → returns zeroed/empty structure (guarded so a missing
 * table on the very first deploy doesn't 500). The UI renders a "no data in
 * range" empty state, never a fabricated 0 that reads like a real result.
 */

// Approximate "session" window: how long after a Closing Soon click a downstream
// signup event is attributed to that click. Signup is a single sitting, so 2h is
// generous but avoids coupling distinct visits from the same device.
const SESSION_WINDOW_HOURS = 2;

// View step = any recorded signup-page view (cold `signup_view` + `_with_score`).
const VIEW_EVENT_SQL = "('signup_view','signup_view_with_score')";

interface FunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  sessionWindowHours: number;
  buttonRowIndistinguishable: boolean;
  // Raw event counts in range — global, NOT attributed to any click path.
  rawInRange: {
    closingSoonClicks: number;
    viewEvents: number;
    submitEvents: number;
    successEvents: number;
  };
  // Attributed funnel anchored on the Closing Soon click cohort (distinct
  // (ip,user_agent) visitors), each downstream step = cohort members who also
  // produced that step's event within the session window after their click.
  attributed: {
    clickVisitors: number;
    clickEvents: number;
    viewed: number;
    submitted: number;
    succeeded: number;
    // rates (0-1), null when the divisor is 0
    clickToView: number | null;
    clickToSubmit: number | null;
    clickToSuccess: number | null;
    viewToSubmit: number | null;
    submitToSuccess: number | null;
  };
}

// Count distinct (ip, user_agent) visitors anchored on the Closing Soon click
// cohort that ALSO produced the given downstream step (event-set SQL fragment)
// after their click, within the session window.
async function attributedStepCount(
  fromSql: string,
  stepEventSql: string,
): Promise<number> {
  const rows = await sql()`
    SELECT COUNT(*) AS c FROM (
      SELECT DISTINCT COALESCE(c.ip, ''), COALESCE(c.user_agent, '')
      FROM funnel_events c
      JOIN funnel_events d
        ON d.ip = c.ip AND d.user_agent = c.user_agent
        AND d.event_name IN ${sql().unsafe(stepEventSql)}
        AND d.created_at > c.created_at
        AND d.created_at <= c.created_at + make_interval(hours => ${sql().unsafe(String(SESSION_WINDOW_HOURS))})
      WHERE c.event_name = 'signup_cta_click'
        AND c.label = 'home_closing_soon'
        AND c.created_at >= ${fromSql}
    ) x
  `;
  return Number(rows[0]?.c ?? 0);
}

function emptyResult(rangeDays: number, now: Date, from: Date): FunnelResult {
  return {
    rangeDays,
    from: from.toISOString(),
    to: now.toISOString(),
    sessionWindowHours: SESSION_WINDOW_HOURS,
    buttonRowIndistinguishable: true,
    rawInRange: { closingSoonClicks: 0, viewEvents: 0, submitEvents: 0, successEvents: 0 },
    attributed: {
      clickVisitors: 0,
      clickEvents: 0,
      viewed: 0,
      submitted: 0,
      succeeded: 0,
      clickToView: null,
      clickToSubmit: null,
      clickToSuccess: null,
      viewToSubmit: null,
      submitToSuccess: null,
    },
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
  const fromSql = from.toISOString();

  function pct(n: number, d: number): number | null {
    if (!d) return null;
    return Math.round((n / d) * 1000) / 10; // one decimal
  }

  try {
    // Guard: if the funnel table doesn't exist yet (first deploy before any
    // /api/event call), degrade to an honest empty result rather than 500.
    const tableExists = await sql()`SELECT to_regclass('public.funnel_events') AS t`;
    if (!(tableExists[0] as any)?.t) {
      return Response.json(emptyResult(rangeDays, now, from));
    }

    // 1) Raw event counts in range (global, not attributed).
    const raw = await sql()`
      SELECT
        COUNT(*) FILTER (WHERE event_name = 'signup_cta_click' AND label = 'home_closing_soon') AS closing_click,
        COUNT(*) FILTER (WHERE event_name IN ${sql().unsafe(VIEW_EVENT_SQL)}) AS view_events,
        COUNT(*) FILTER (WHERE event_name = 'signup_submit') AS submit_events,
        COUNT(*) FILTER (WHERE event_name = 'signup_success') AS success_events
      FROM funnel_events
      WHERE created_at >= ${fromSql}
    `;

    // 2) Closing Soon click cohort.
    const cohort = await sql()`
      SELECT
        COUNT(*) AS click_events,
        COUNT(DISTINCT (COALESCE(ip, ''), COALESCE(user_agent, ''))) AS click_visitors
      FROM funnel_events
      WHERE event_name = 'signup_cta_click'
        AND label = 'home_closing_soon'
        AND created_at >= ${fromSql}
    `;

    // 3) Attributed downstream steps.
    const clickVisitors = Number((cohort[0] as any)?.click_visitors ?? 0);
    const viewed = await attributedStepCount(fromSql, VIEW_EVENT_SQL);
    const submitted = await attributedStepCount(fromSql, "('signup_submit')");
    const succeeded = await attributedStepCount(fromSql, "('signup_success')");

    const result: FunnelResult = {
      rangeDays,
      from: fromSql,
      to: now.toISOString(),
      sessionWindowHours: SESSION_WINDOW_HOURS,
      buttonRowIndistinguishable: true,
      rawInRange: {
        closingSoonClicks: Number((raw[0] as any)?.closing_click ?? 0),
        viewEvents: Number((raw[0] as any)?.view_events ?? 0),
        submitEvents: Number((raw[0] as any)?.submit_events ?? 0),
        successEvents: Number((raw[0] as any)?.success_events ?? 0),
      },
      attributed: {
        clickVisitors,
        clickEvents: Number((cohort[0] as any)?.click_events ?? 0),
        viewed,
        submitted,
        succeeded,
        clickToView: pct(viewed, clickVisitors),
        clickToSubmit: pct(submitted, clickVisitors),
        clickToSuccess: pct(succeeded, clickVisitors),
        viewToSubmit: pct(submitted, viewed),
        submitToSuccess: pct(succeeded, submitted),
      },
    };

    return Response.json(result);
  } catch (err) {
    console.error("[api/admin/closing-soon-funnel] error:", err);
    return Response.json({ error: "Failed to load funnel" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/closing-soon-funnel")({
  server: { handlers: { GET: handler } },
});
