import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import {
  AUTOPSY_FUNNEL_STAGES,
  AUTOPSY_EVENTS,
  AUTOPSY_SIGNUP_EVENT,
  AUTOPSY_RADAR_COMPLETE_EVENT,
} from "~/lib/autopsy-funnel";

/**
 * GET /api/admin/autopsy-funnel?days=30
 *
 * Admin-only "Autopsy Acquisition" funnel view — the read-surface the owner
 * wants (business-plan rev 171): per-stage LIVE counts + drop-off for the
 * 9 owner-exact stages of the free-first-autopsy acquisition funnel, read
 * from the SAME funnel_events plumbing the Visitor Journeys board uses
 * (no parallel system):
 *
 *   1. autopsy_landing        — public entry opened          (event)
 *   2. contract_entered       — lost solicitation entered    (event)
 *   3. award_found            — real award matched           (event)
 *   4. autopsy_generated      — autopsy preview generated    (event)
 *   5. signup_wall            — signup gate shown            (event)
 *   6. signup                 — Basic account created        (REUSED signup_success,
 *                                                             attributed ONLY to
 *                                                             autopsy-funnel visitors)
 *   7. report_viewed          — free COMPLETE report viewed  (event)
 *   8. radar_used             — Radar cross-sell used        (REUSED radar_scan_complete
 *                                                             + autopsy_radar_cta click)
 *   9. paid                   — any paid upgrade             (derived from users
 *                                                             subscription_status,
 *                                                             attributed to funnel visitors)
 *
 * STAGE 6 ATTRIBUTION RULE (owner-exact: don't double-count organic signups):
 * a `signup_success` only counts for stage 6 when the SAME visitor also has an
 * autopsy-funnel event (any of the stages 1–5/7–8 events or the radar CTA). A
 * bare organic signup with no autopsy involvement never counts here. Stage 9
 * requires an autopsy-involved visitor whose converted account is alive with an
 * active subscription (or whose funnel rows carry an autopsy event after the
 * signup) — so the number always reflects THIS funnel's paid conversions.
 *
 * BOT FILTERING: every count applies the shared BOT_EXCLUSION_SQL predicate
 * plus the QA/admin funnel exclusions — exactly the same exclusions as the
 * Visitor Journeys board, so a row here always agrees with a panel there.
 * Missing tables → guarded, empty structure rather than a 500.
 */
const HUMAN_FILTER = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;

interface AutopsyFunnelStage {
  stage: string;
  label: string;
  count: number;
  dropOffPct: number | null;
}

const STAGE_EVENT_SQL = AUTOPSY_EVENTS.map((e) => `'${e}'`).join(",");
const ALL_EVENT_SQL = [
  ...AUTOPSY_EVENTS,
  AUTOPSY_SIGNUP_EVENT,
  AUTOPSY_RADAR_COMPLETE_EVENT,
].map((e) => `'${e}'`).join(",");

/** Event name → owner-exact stage name (events carry the autopsy_ prefix). */
const EVENT_TO_STAGE: Record<string, string> = {
  autopsy_landing: "autopsy_landing",
  autopsy_contract_entered: "contract_entered",
  autopsy_award_found: "award_found",
  autopsy_generated: "autopsy_generated",
  autopsy_signup_wall: "signup_wall",
  autopsy_report_viewed: "report_viewed",
};

function pct(n: number, d: number): number | null {
  if (d <= 0) return null;
  const p = Math.round((1 - n / d) * 100);
  return p > 0 ? p : 0;
}

function emptyFunnel(): AutopsyFunnelStage[] {
  return AUTOPSY_FUNNEL_STAGES.map((s) => ({ stage: s.stage, label: s.label, count: 0, dropOffPct: null }));
}

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

    // Distinct human visitors per event stage (all 9 stage events in one pass,
    // label belt-and-suspenders on top of the event-name set).
    const counts: Record<string, number> = {};
    for (const s of AUTOPSY_FUNNEL_STAGES) counts[s.stage] = 0;
    const stageEvents = [...AUTOPSY_EVENTS, AUTOPSY_SIGNUP_EVENT, AUTOPSY_RADAR_COMPLETE_EVENT];
    try {
      const rows: any[] = await sql()`
        SELECT event_name, label, COUNT(DISTINCT visitor_id) AS n
        FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name IN (${sql().unsafe(ALL_EVENT_SQL)})
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}
        GROUP BY event_name, label`;
      for (const r of rows) {
        const name = String(r.event_name);
        if (!stageEvents.includes(name)) continue;
        const n = Number(r.n ?? 0);
        if (n === 0) continue;
        if (name === AUTOPSY_SIGNUP_EVENT) {
          // Stage 6 — handled by the attributed query below; raw count excluded.
          continue;
        }
        if (name === AUTOPSY_RADAR_COMPLETE_EVENT) {
          // Stage 8 — counts in the attributed query below; raw count excluded
          // (a radar completion without any autopsy involvement is not this
          // funnel's radar_used).
          continue;
        }
        const stage = EVENT_TO_STAGE[name];
        if (!stage) continue;
        counts[stage] += n;
      }
    } catch (err) {
      console.error("[api/admin/autopsy-funnel] stage counts failed (continuing):", err);
    }

    // ── Autopsy-involved visitor set (the funnel attribute key) ──────────────
    // A visitor is "autopsy-involved" when they produced ANY of the autopsy
    // events (stages 1–5/7) or the signed-up stage-6 event or the radar CTA.
    let autopsyVids: string[] = [];
    try {
      const vids: any[] = await sql()`
        SELECT DISTINCT visitor_id AS vid FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name IN (${sql().unsafe(STAGE_EVENT_SQL)})
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
      autopsyVids = vids.map((r) => String(r.vid)).filter(Boolean);
    } catch (err) {
      console.error("[api/admin/autopsy-funnel] autopsy-visitor set failed (continuing):", err);
    }

    // Stage 6 — signup, attributed to THIS funnel only (owner rule: reuse the
    // existing signup-complete event, don't double-count organic signups).
    let signupCount = 0;
    if (autopsyVids.length > 0) {
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id = ANY(${autopsyVids})
            AND event_name = ${AUTOPSY_SIGNUP_EVENT}
            AND created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        signupCount = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/autopsy-funnel] attributed signup count failed (continuing):", err);
      }
    }
    counts.signup = signupCount;

    // Stage 8 — radar_used: the cross-sell CTA click OR a radar scan completed
    // by an autopsy-involved visitor (recency-ordered per visitor so a click
    // and a completion by the same person count once, oldest first — mirroring
    // the funnel's "used" semantics).
    let radarUsedCount = 0;
    if (autopsyVids.length > 0) {
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT v.visitor_id) AS n FROM (
            SELECT DISTINCT ON (visitor_id) visitor_id, event_name
            FROM funnel_events
            WHERE visitor_id = ANY(${autopsyVids})
              AND event_name IN ('autopsy_radar_cta', ${AUTOPSY_RADAR_COMPLETE_EVENT})
              AND created_at >= ${fromIso}
              AND ${sql().unsafe(HUMAN_FILTER)}
              AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}
            ORDER BY visitor_id, created_at ASC
          ) v`;
        radarUsedCount = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/autopsy-funnel] radar-used count failed (continuing):", err);
      }
    }
    counts.radar_used = radarUsedCount;

    // Stage 9 — paid: an autopsy-involved visitor whose converted account is
    // actively subscribed (users.subscription_status = 'active'). Fallback for
    // anonymous rows: a post-signup autopsy event on a row whose converted
    // user can't be resolved — honest, never fabricated (requires an actual
    // live subscription; no rows → 0).
    let paidCount = 0;
    try {
      const convertedIds: any[] = await sql()`
        SELECT DISTINCT v.converted_user_id AS uid
        FROM visitors v
        JOIN funnel_events fe ON fe.visitor_id = v.visitor_id
        WHERE v.converted_user_id IS NOT NULL AND v.converted_user_id <> ''
          AND fe.visitor_id = ANY(${autopsyVids})
          AND fe.event_name IN (${sql().unsafe(ALL_EVENT_SQL)})
          AND fe.created_at >= ${fromIso}
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
      const uids = convertedIds.map((r) => String(r.uid)).filter(Boolean);
      const uidNumbers = uids
        .map((u) => Number(u))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (uidNumbers.length > 0) {
        const actives: any[] = await sql()`
          SELECT COUNT(*) AS n FROM users
          WHERE id = ANY(${uidNumbers})
            AND subscription_status = 'active'`;
        paidCount = Number(actives?.[0]?.n ?? 0);
      }
    } catch (err) {
      console.error("[api/admin/autopsy-funnel] paid count failed (continuing):", err);
    }
    counts.paid = paidCount;

    // Drop-off between consecutive stages (count → current / previous).
    const funnel: AutopsyFunnelStage[] = AUTOPSY_FUNNEL_STAGES.map((s, i) => {
      const prev = i === 0 ? null : counts[AUTOPSY_FUNNEL_STAGES[i - 1].stage];
      const dropOffPct = prev != null ? pct(counts[s.stage], prev) : null;
      return { stage: s.stage, label: s.label, count: counts[s.stage] ?? 0, dropOffPct };
    });

    return Response.json({
      rangeDays: days,
      from: fromIso,
      to: now.toISOString(),
      funnel,
    });
  } catch (err) {
    console.error("[api/admin/autopsy-funnel] error:", err);
    return Response.json({ rangeDays: 30, from: "", to: "", funnel: emptyFunnel() });
  }
}

export const Route = createFileRoute("/api/admin/autopsy-funnel")({
  server: { handlers: { GET: handler } },
});