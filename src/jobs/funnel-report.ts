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
 * "Clicked upgrade" counts *_upgrade_click and *checkout_started events; the
 * plan buy buttons fire plan_checkout_started only from 2026-10-19 on.
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
  console.log("ℹ️ Plan buy buttons are tracked from 2026-10-19 (plan_checkout_*); earlier checkout starts are not countable.");

  await signupBreakdown(days, human);
  await checkoutBreakdown(days, human);
}

/**
 * Where the signup page loses people (owner 2026-10-19: 27 saw it, 3 signed
 * up). Per visitor who saw the page: did they start the form, which fields
 * they reached, submit, errors, success, and how long non-starters stayed.
 */
async function signupBreakdown(days: number, human: string): Promise<void> {
  const db = sql();
  const [s] = (await db`
    WITH viewers AS (
      SELECT DISTINCT visitor_id FROM funnel_events
      WHERE created_at > NOW() - make_interval(days => ${days})
        AND visitor_id IS NOT NULL
        AND event_name = ANY(${[...SIGNUP_VIEWED_EVENTS]})
        AND ${db.unsafe(human)}
    ),
    ev AS (
      SELECT f.visitor_id,
             BOOL_OR(f.event_name = 'signup_start') AS started,
             BOOL_OR(f.event_name = 'signup_field_reached' AND f.label = 'email') AS email,
             BOOL_OR(f.event_name = 'signup_field_reached' AND f.label = 'password') AS password,
             BOOL_OR(f.event_name = 'signup_field_reached' AND f.label = 'company') AS company,
             BOOL_OR(f.event_name = 'signup_submit') AS submitted,
             BOOL_OR(f.event_name = 'signup_error') AS errored,
             BOOL_OR(f.event_name = 'signup_success') AS succeeded,
             BOOL_OR(f.event_name = 'signup_google_click') AS google,
             BOOL_OR(f.event_name = 'signup_exit' AND f.label LIKE 'view%') AS left_before_typing
      FROM funnel_events f JOIN viewers v ON v.visitor_id = f.visitor_id
      WHERE f.created_at > NOW() - make_interval(days => ${days})
      GROUP BY f.visitor_id
    )
    SELECT COUNT(*)::int AS viewed,
           COUNT(*) FILTER (WHERE started)::int AS started,
           COUNT(*) FILTER (WHERE email)::int AS email,
           COUNT(*) FILTER (WHERE password)::int AS password,
           COUNT(*) FILTER (WHERE company)::int AS company,
           COUNT(*) FILTER (WHERE submitted)::int AS submitted,
           COUNT(*) FILTER (WHERE errored)::int AS errored,
           COUNT(*) FILTER (WHERE succeeded)::int AS succeeded,
           COUNT(*) FILTER (WHERE google)::int AS google,
           COUNT(*) FILTER (WHERE left_before_typing AND NOT google)::int AS left_before_typing
    FROM ev
  `) as Record<string, number>[];
  console.log("");
  console.log(`📝 Signup page, last ${days} days (visitors who saw it)`);
  for (const [k, label] of [
    ["viewed", "Saw the signup page"],
    ["started", "Clicked into the form"],
    ["email", "Reached email"],
    ["password", "Reached password"],
    ["company", "Reached company"],
    ["submitted", "Pressed submit"],
    ["errored", "Got an error"],
    ["succeeded", "Signed up"],
    ["google", "Tapped Continue with Google (tracked from 2026-10-19)"],
    ["left_before_typing", "Left without typing or tapping Google"],
  ] as const) {
    console.log(`${label} | ${s[k]}`);
  }

  // Accounts created through Google in the window (google_accounts row within
  // 10 minutes of the account), whether or not the visit was tracked.
  const [g] = (await db`
    SELECT COUNT(*)::int AS n
    FROM users u JOIN google_accounts ga ON ga.user_id = u.id
    WHERE u.created_at > NOW() - make_interval(days => ${days})
      AND ga.created_at <= u.created_at + INTERVAL '10 minutes'
      AND ${db.unsafe(qaExternalUserSQL("u."))}
  `.catch(() => [{ n: 0 }])) as { n: number }[];
  console.log(`New accounts made with Google | ${g?.n ?? 0}`);

  const errors = (await db`
    SELECT LEFT(COALESCE(label, '(none)'), 120) AS message, COUNT(DISTINCT visitor_id)::int AS visitors
    FROM funnel_events
    WHERE created_at > NOW() - make_interval(days => ${days})
      AND event_name = 'signup_error'
      AND ${db.unsafe(human)}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as { message: string; visitors: number }[];
  if (errors.length) {
    console.log("Signup errors (message | visitors):");
    for (const e of errors) console.log(`  ${e.message} | ${e.visitors}`);
  }

  const dwell = (await db`
    SELECT label,
           COUNT(*)::int AS exits,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (path::jsonb ->> 'seconds_on_page')::numeric) AS median_seconds
    FROM funnel_events
    WHERE created_at > NOW() - make_interval(days => ${days})
      AND event_name = 'signup_exit'
      AND path LIKE '{%'
      AND ${db.unsafe(human)}
    GROUP BY label ORDER BY exits DESC
  `.catch(() => [])) as { label: string; exits: number; median_seconds: number | null }[];
  if (dwell.length) {
    console.log("Exits without signing up (cohort | exits | median seconds on page):");
    for (const d of dwell) console.log(`  ${d.label} | ${d.exits} | ${d.median_seconds == null ? "-" : Math.round(Number(d.median_seconds))}`);
  }
}

/** Plan buy-button outcomes (tracked from 2026-10-19). */
async function checkoutBreakdown(days: number, human: string): Promise<void> {
  const db = sql();
  const rows = (await db`
    SELECT event_name, label, COUNT(DISTINCT visitor_id)::int AS visitors
    FROM funnel_events
    WHERE created_at > NOW() - make_interval(days => ${days})
      AND event_name LIKE 'plan_checkout_%'
      AND ${db.unsafe(human)}
    GROUP BY 1, 2 ORDER BY 1, 3 DESC
  `) as { event_name: string; label: string | null; visitors: number }[];
  console.log("");
  console.log("💳 Plan buy buttons (event | plan | visitors)");
  if (!rows.length) console.log("  none yet");
  for (const r of rows) console.log(`  ${r.event_name} | ${r.label ?? "-"} | ${r.visitors}`);
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
