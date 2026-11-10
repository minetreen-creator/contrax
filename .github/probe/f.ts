// Read-only probe: last 7 days of the sales funnel. Counts only; robots and admin accounts excluded.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const wk = s`created_at > NOW() - INTERVAL '7 days'`;
const [v] = (await s`SELECT COUNT(DISTINCT visitor_id)::int AS visitors, COUNT(*)::int AS views FROM page_views WHERE ${wk} AND ${NOT_BOT}`) as Record<string, number>[];
const ev = async (names: string[]) =>
  ((await s`SELECT COUNT(DISTINCT COALESCE(visitor_id, user_id, ip))::int AS n FROM funnel_events WHERE ${wk} AND event_name = ANY(${names}) AND ${NOT_BOT}`) as { n: number }[])[0].n;
const steps: [string, string[]][] = [
  ["radar search started", ["radar_scan_start"]],
  ["radar search finished", ["radar_scan_complete"]],
  ["saw the signup page", ["signup_view", "signup_view_with_score", "signup_viewed_from_radar", "signup_landed_radar"]],
  ["started signing up", ["signup_start", "signup_field_reached", "signup_google_click"]],
  ["submitted signup", ["signup_submit"]],
  ["signup succeeded", ["signup_success", "signup_completed_from_radar"]],
  ["clicked a $5 / buy button", ["bid_top_starter_click", "radar_bids_first_starter", "pricing_starter_click", "home_starter_pass_click", "bid_lock_starter_click", "checklist_starter", "basic_upgrade_bar_click", "resume_checkout_click"]],
  ["checkout started", ["plan_checkout_started"]],
  ["reached Stripe", ["checkout_session_created", "plan_checkout_redirected"]],
  ["checkout failed", ["plan_checkout_failed"]],
  ["signin required at checkout", ["plan_checkout_signin_required"]],
];
console.log(`FUNNEL7 real visitors ${v.visitors} (page views ${v.views})`);
for (const [label, names] of steps) console.log(`FUNNEL7 ${label}: ${await ev(names)}`);
const [u] = (await s`
  SELECT COUNT(*)::int AS new_accounts,
         COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL)::int AS new_with_stripe
  FROM users WHERE ${wk} AND NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax'`) as Record<string, number>[];
console.log(`FUNNEL7 new accounts ${u.new_accounts}; of them linked to Stripe ${u.new_with_stripe}`);
const [p] = (await s`
  SELECT COUNT(*)::int AS n FROM users
  WHERE NOT COALESCE(is_admin, false) AND email NOT ILIKE '%@test.contrax' AND stripe_customer_id IS NOT NULL
    AND (subscription_status = 'active' OR access_expires_at > NOW())`) as { n: number }[];
console.log(`FUNNEL7 accounts with paid access now (Stripe-linked) ${p.n}`);
const fails = (await s`SELECT label, COUNT(*)::int AS n FROM funnel_events WHERE ${wk} AND event_name IN ('plan_checkout_failed','signup_error') GROUP BY 1 ORDER BY 2 DESC LIMIT 8`) as { label: string; n: number }[];
console.log("FUNNEL7 failures by label:", fails.map((f) => `${f.label} ${f.n}`).join("; "));
process.exit(0);
