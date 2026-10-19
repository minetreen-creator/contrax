/**
 * Visitor-to-revenue funnel report — CLI entrypoint (`bun run funnel-report`),
 * run by hand from .github/workflows/funnel-report.yml (owner 2026-10-19:
 * "I have still no revenue...help me" → find the step that loses the most
 * people). Read-only; prints counts and percentages, never a visitor, IP or
 * email.
 *
 * Steps, per unique visitor over the last N days (bots, admins and QA
 * accounts excluded the same way as the admin boards):
 *   visited → ran a search → got matches → saw signup → signed up →
 *   saw pricing/upgrade → clicked an upgrade button
 * Then account-level: new accounts, trials started, paying now.
 * Each visitor step is split by paid ads vs other and phone vs desktop.
 *
 * Note: the /pricing and /upgrade plan buttons fire no event, so a Starter or
 * Professional checkout start cannot be counted; "clicked upgrade" counts the
 * *_upgrade_click events that do exist (bid contact, trial recap, …).
 */
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { adminFunnelExclusionSQL, qaExternalUserSQL, qaFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { SIGNUP_VIEWED_EVENTS } from "~/lib/tracking-intake";

const MATCH_EVENTS = ["radar_scan_signed_in_matches", "radar_scan_anonymous_matches"];

export async function funnelReport(days: number): Promise<void> {
  const db = sql();
  const human = `NOT ${BOT_EXCLUSION_SQL} AND ${qaFunnelExclusionSQL()} AND ${adminFunnelExclusionSQL()}`;
  const rows = (await db`
    WITH pv AS (
      SELECT visitor_id,
             BOOL_OR(LOWER(COALESCE(medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsocial', 'display')) AS paid,
             BOOL_OR(LOWER(COALESCE(device_type, '')) = 'mobile') AS mobile,
             BOOL_OR(path = '/pricing' OR path LIKE '/pricing?%' OR path = '/upgrade' OR path LIKE '/upgrade?%') AS pricing
      FROM page_views
      WHERE created_at > NOW() - make_interval(days => ${days})
        AND visitor_id IS NOT NULL
        AND path NOT LIKE '/admin%'
        AND ${db.unsafe(human)}
      GROUP BY visitor_id
    ),
    fe AS (
      SELECT visitor_id,
             BOOL_OR(event_name = 'radar_scan_start') AS searched,
             BOOL_OR(event_name = ANY(${MATCH_EVENTS})) AS matched,
             BOOL_OR(event_name = ANY(${[...SIGNUP_VIEWED_EVENTS]})) AS saw_signup,
             BOOL_OR(event_name = 'signup_success') AS signed_up,
             BOOL_OR(event_name LIKE '%upgrade_click%' OR event_name LIKE '%checkout_started%') AS upgrade
      FROM funnel_events
      WHERE created_at > NOW() - make_interval(days => ${days})
        AND visitor_id IS NOT NULL
        AND ${db.unsafe(human)}
      GROUP BY visitor_id
    )
    SELECT CASE WHEN pv.paid THEN 'paid ads' ELSE 'other' END AS channel,
           CASE WHEN pv.mobile THEN 'phone' ELSE 'desktop' END AS device,
           COUNT(*)::int AS visited,
           COUNT(*) FILTER (WHERE fe.searched)::int AS searched,
           COUNT(*) FILTER (WHERE fe.matched)::int AS matched,
           COUNT(*) FILTER (WHERE fe.saw_signup)::int AS saw_signup,
           COUNT(*) FILTER (WHERE fe.signed_up)::int AS signed_up,
           COUNT(*) FILTER (WHERE pv.pricing)::int AS pricing,
           COUNT(*) FILTER (WHERE fe.upgrade)::int AS upgrade
    FROM pv LEFT JOIN fe ON fe.visitor_id = pv.visitor_id
    GROUP BY 1, 2
    ORDER BY 1, 2
  `) as Record<string, string | number>[];

  const steps = ["visited", "searched", "matched", "saw_signup", "signed_up", "pricing", "upgrade"] as const;
  const label: Record<(typeof steps)[number], string> = {
    visited: "Visited the site",
    searched: "Ran a search",
    matched: "Search found matches",
    saw_signup: "Saw the signup page",
    signed_up: "Signed up",
    pricing: "Saw pricing / upgrade",
    upgrade: "Clicked an upgrade button",
  };
  const total = Object.fromEntries(steps.map((s) => [s, rows.reduce((n, r) => n + Number(r[s]), 0)])) as Record<string, number>;
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

  console.log(`📉 Funnel, last ${days} days (unique visitors; bots, admins and test accounts excluded)`);
  console.log("step | visitors | % of visitors | % of previous step");
  steps.forEach((s, i) => {
    const prev = i ? total[steps[i - 1]] : total[s];
    console.log(`${label[s]} | ${total[s]} | ${pct(total[s], total.visited)} | ${i ? pct(total[s], prev) : "-"}`);
  });

  console.log("");
  console.log("By channel and device");
  console.log(`channel | device | ${steps.join(" | ")}`);
  for (const r of rows) console.log(`${r.channel} | ${r.device} | ${steps.map((s) => r[s]).join(" | ")}`);

  const [acct] = (await db`
    SELECT COUNT(*) FILTER (WHERE created_at > NOW() - make_interval(days => ${days}))::int AS new_accounts,
           COUNT(*) FILTER (WHERE trial_started_at > NOW() - make_interval(days => ${days}))::int AS trials,
           COUNT(*) FILTER (WHERE subscription_status = 'active')::int AS paying
    FROM users
    WHERE ${db.unsafe(qaExternalUserSQL())}
  `) as { new_accounts: number; trials: number; paying: number }[];
  console.log("");
  console.log(`👤 Accounts: ${acct.new_accounts} new in ${days} days · ${acct.trials} trials started · ${acct.paying} paying now`);
  console.log("ℹ️ The /pricing and /upgrade plan buttons fire no event, so Starter/Professional checkout starts are not countable yet.");
}

if (import.meta.main) {
  try {
    const days = Math.min(90, Math.max(1, Number(process.env.DAYS ?? 30) || 30));
    await funnelReport(days);
    process.exit(0);
  } catch (e) {
    console.error("💥 Funnel report crashed:", e);
    process.exit(1);
  }
}
