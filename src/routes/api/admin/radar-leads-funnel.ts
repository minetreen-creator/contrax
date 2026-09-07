import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";
import {
  RADAR_LEADS_FUNNEL_STAGES,
  RADAR_LEADS_EVENTS,
  RADAR_LEADS_SIGNUP_EVENT,
  RADAR_LEADS_RADAR_COMPLETE_EVENT,
  maskLeadEmail,
  emptyRadarLeadsFunnel,
} from "~/lib/radar-leads-funnel";

/**
 * GET /api/admin/radar-leads-funnel?days=30
 *
 * Admin-only "Radar Leads" funnel + masked lead table (owner 2026-09-06/07).
 * Reads the SAME funnel_events plumbing as every other admin surface (no
 * parallel system):
 *
 *   1. capture          — radar_lead_captured      (Capture form submitted)
 *   2. confirmed        — email_confirmed          (confirm link opened)
 *   3. alert_sent       — radar_alert_sent         (match-alert email sent)
 *   4. click            — opportunity_clicked      ("View opportunity →" CTA)
 *   5. signup           — REUSED signup_success, attributed ONLY to
 *                         radar-funnel visitors (organic signups never count)
 *   6. radar_used       — REUSED radar_scan_complete, attributed to
 *                         radar-funnel visitors
 *   7. paid             — derived from users.subscription_status = 'active'
 *                         on accounts whose visitor is radar-funnel-involved
 *
 * Stages 1–4 are per-event DISTINCT visitor counts; 5–7 use the funnel-involved
 * visitor set (autopsy-funnel attribution rule, owner-exact: don't double-count
 * organic signups).
 *
 * MASKED LEAD TABLE (LIMIT 200, created_at DESC): id, email MASKED to
 * first-char + domain (never the full address — mirror of visitor-intel's
 * masking), trade/cert/sizePref from radar_profile (profile is not stored PII
 * the same way, but kept minimal), confirmed/unsubscribed/last-alerted/last-
 * clicked timestamps, click_count. The unsubscribe_token is NEVER selected.
 *
 * BOT/QA/ADMIN EXCLUSIONS: every funnel count AND the lead table apply the
 * shared HUMAN_FILTER (BOT_EXCLUSION_SQL + qaFunnelExclusion + adminFunnel
 * exclusion) plus visitorsBotExclusionSQL's visitor_id arms — exactly the
 * exclusions the Visitor Journeys board applies to its funnel — so a row here
 * always agrees with a panel there. Missing tables → guarded empty structure
 * rather than a 500.
 */
const HUMAN_FILTER = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)`;
/** Inclusion predicate (rows that ARE bot/QA/admin) used to collect the
 *  visitor_ids we must exclude from the masked lead table. */
function botQaAdminVidSql(): string {
  const adminIn = [...ADMIN_EMAILS]
    .map((e) => `LOWER(COALESCE(user_email,'')) = '${e.toLowerCase()}'`)
    .join(" OR ");
  return `(
    ${BOT_EXCLUSION_SQL}
    OR LOWER(COALESCE(user_email,'')) LIKE '%@test.contrax'
    OR (${adminIn || "TRUE"})
  )`;
}

const STAGE_EVENT_SQL = RADAR_LEADS_EVENTS.map((e) => `'${e}'`).join(",");
const INVOLVED_EVENT_SQL = [...RADAR_LEADS_EVENTS, RADAR_LEADS_SIGNUP_EVENT, RADAR_LEADS_RADAR_COMPLETE_EVENT]
  .map((e) => `'${e}'`)
  .join(",");

function pct(n: number, d: number): number | null {
  if (d <= 0) return null;
  const p = Math.round((1 - n / d) * 100);
  return p > 0 ? p : 0;
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
    const result = emptyRadarLeadsFunnel(days);

    // ── Stages 1–4: per-event distinct-visitor counts (funnel_events) ───────
    // capture/confirmed are channel-stage events (confirmed = 'lead-confirm'
    // label, fired only on the unconfirmed→confirmed transition). alert_sent is
    // recorded server-side by the periodic sender. opportunity_clicked by the
    // PII-safe redirect route. All with the shared HUMAN_FILTER.
    const counts: Record<string, number> = {};
    for (const s of RADAR_LEADS_FUNNEL_STAGES) counts[s.stage] = 0;
    try {
      const rows: any[] = await sql()`
        SELECT event_name, COUNT(DISTINCT visitor_id) AS n
        FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name IN (${sql().unsafe(STAGE_EVENT_SQL)})
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}
        GROUP BY event_name`;
      for (const r of rows) {
        const name = String(r.event_name);
        const stage = { radar_lead_captured: "capture", email_confirmed: "confirmed", radar_alert_sent: "alert_sent", opportunity_clicked: "click" }[name];
        if (stage) counts[stage] = Number(r.n ?? 0);
      }
    } catch (err) {
      console.error("[api/admin/radar-leads-funnel] stage counts failed (continuing):", err);
    }

    // ── Radar-funnel-involved visitor set (the attribution key) ─────────────
    let funnelVids: string[] = [];
    try {
      const vids: any[] = await sql()`
        SELECT DISTINCT visitor_id AS vid FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND created_at >= ${fromIso}
          AND event_name IN (${sql().unsafe(STAGE_EVENT_SQL)})
          AND ${sql().unsafe(HUMAN_FILTER)}
          AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
      funnelVids = vids.map((r) => String(r.vid)).filter(Boolean);
    } catch (err) {
      console.error("[api/admin/radar-leads-funnel] funnel-visitor set failed (continuing):", err);
    }

    // ── Stage 5 — signup, attributed to THIS funnel only (owner rule) ───────
    let signupCount = 0;
    if (funnelVids.length > 0) {
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id = ANY(${funnelVids})
            AND event_name = ${RADAR_LEADS_SIGNUP_EVENT}
            AND created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        signupCount = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/radar-leads-funnel] attributed signup count failed (continuing):", err);
      }
    }
    counts.signup = signupCount;

    // ── Stage 6 — radar_used (REUSED radar_scan_complete, attributed) ───────
    let radarUsedCount = 0;
    if (funnelVids.length > 0) {
      try {
        const rows: any[] = await sql()`
          SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
          WHERE visitor_id = ANY(${funnelVids})
            AND event_name = ${RADAR_LEADS_RADAR_COMPLETE_EVENT}
            AND created_at >= ${fromIso}
            AND ${sql().unsafe(HUMAN_FILTER)}
            AND ${sql().unsafe(qaFilter)} AND ${sql().unsafe(adminFilter)}`;
        radarUsedCount = Number(rows?.[0]?.n ?? 0);
      } catch (err) {
        console.error("[api/admin/radar-leads-funnel] radar-used count failed (continuing):", err);
      }
    }
    counts.radar_used = radarUsedCount;

    // ── Stage 7 — paid: radar-funnel visitor whose converted account is
    //    actively subscribed. Honest — only real live subscriptions count.
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
        console.error("[api/admin/radar-leads-funnel] paid count failed (continuing):", err);
      }
    }
    counts.paid = paidCount;

    // ── Drop-off between consecutive stages (count → current / previous) ────
    result.funnel = RADAR_LEADS_FUNNEL_STAGES.map((s, i) => {
      const prev = i === 0 ? null : counts[RADAR_LEADS_FUNNEL_STAGES[i - 1].stage];
      const dropOffPct = prev != null ? pct(counts[s.stage], prev) : null;
      return { stage: s.stage, label: s.label, count: counts[s.stage] ?? 0, dropOffPct };
    });

    // ── MASKED LEAD TABLE ──────────────────────────────────────────────────
    // The lead's visitor_id drives the same exclusions as the funnel (bots/QA/
    // admin visiting and THEN leaving a lead still count as test traffic):
    // exclude a lead when its visitor_id matches any bot/QA/admin funnel row,
    // or when the captured visitor_id looks like a QA probe (visitorsBotExclusion
    // arms that apply to visitor_id only). Missing table → guarded empty array.
    try {
      const excluded = (await sql()`
        SELECT DISTINCT visitor_id AS vid FROM funnel_events
        WHERE visitor_id IS NOT NULL AND visitor_id <> ''
          AND ${sql().unsafe(botQaAdminVidSql())}
      `) as Array<{ vid: string }>;
      const excludedIds = excluded.map((r) => String(r.vid)).filter(Boolean);
      let leadRows: any[] = [];
      if (excludedIds.length > 0) {
        leadRows = (await sql()`
          SELECT id, email, radar_profile, confirmed_at, unsubscribed_at, last_alerted_at,
                 click_count, last_clicked_at, created_at
          FROM radar_leads
          WHERE visitor_id IS NULL OR visitor_id = '' OR visitor_id <> ALL(${excludedIds})
          ORDER BY created_at DESC
          LIMIT 200
        `) as any[];
      } else {
        leadRows = (await sql()`
          SELECT id, email, radar_profile, confirmed_at, unsubscribed_at, last_alerted_at,
                 click_count, last_clicked_at, created_at
          FROM radar_leads
          ORDER BY created_at DESC
          LIMIT 200
        `) as any[];
      }
      result.totalLeads = leadRows.length;
      result.leads = leadRows.map((r) => {
        const profile = (r?.radar_profile ?? null) as { trade?: string | null; cert?: string | null; sizePref?: string | null } | null;
        return {
          id: Number(r.id),
          maskedEmail: maskLeadEmail(r?.email) ?? "—",
          trade: profile?.trade ?? null,
          cert: profile?.cert ?? null,
          sizePref: profile?.sizePref ?? null,
          confirmedAt: r?.confirmed_at ? String(r.confirmed_at) : null,
          unsubscribedAt: r?.unsubscribed_at ? String(r.unsubscribed_at) : null,
          lastAlertedAt: r?.last_alerted_at ? String(r.last_alerted_at) : null,
          clickCount: Number(r?.click_count ?? 0),
          lastClickedAt: r?.last_clicked_at ? String(r.last_clicked_at) : null,
          createdAt: r?.created_at ? String(r.created_at) : "",
        };
      });
    } catch (err) {
      console.error("[api/admin/radar-leads-funnel] lead table failed (empty, continuing):", err);
    }

    return Response.json({
      rangeDays: days,
      from: fromIso,
      to: now.toISOString(),
      totalLeads: result.totalLeads,
      funnel: result.funnel,
      leads: result.leads,
    });
  } catch (err) {
    console.error("[api/admin/radar-leads-funnel] error:", err);
    return Response.json(emptyRadarLeadsFunnel(30));
  }
}

export const Route = createFileRoute("/api/admin/radar-leads-funnel")({
  server: { handlers: { GET: handler } },
});