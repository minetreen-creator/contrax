// Temporary read-only check (owner 2026-11-04: "yes" after the first $5 payment).
// Finds the Starter pass bought in the last day by purchase time (no email or
// customer id in this file) and prints its access state and the path the buyer
// took: page paths, event names, referrer host, campaign source, city. No
// emails, names or IPs printed.
import { neon } from "@neondatabase/serverless";
const db = neon(process.env.DATABASE_URL!);
const buyers = (await db.query(`SELECT id, created_at, plan_tier, subscription_status, starter_pass_bought_at, starter_pass_ends_at,
    access_expires_at, COALESCE(is_admin,false) AS is_admin
  FROM users WHERE starter_pass_bought_at > NOW() - INTERVAL '30 hours' ORDER BY starter_pass_bought_at`)) as any[];
console.log(`Starter passes bought in the last 30 hours: ${buyers.length}`);
for (const [i, u] of buyers.entries()) {
  console.log(`\n== buyer ${i + 1}\n` + JSON.stringify({ account_created: u.created_at, plan_tier: u.plan_tier, subscription_status: u.subscription_status,
    pass_bought: u.starter_pass_bought_at, pass_ends: u.starter_pass_ends_at, access_expires_at: u.access_expires_at, is_admin: u.is_admin }));
  const vis = (await db.query(`SELECT DISTINCT visitor_id FROM page_views WHERE user_id::text = $1 AND visitor_id IS NOT NULL`, [String(u.id)])) as any[];
  const ids = vis.map((v) => v.visitor_id);
  const pv = await db.query(`SELECT to_char(created_at AT TIME ZONE 'America/Chicago','MM-DD HH24:MI') AS ct, path,
      split_part(COALESCE(referrer,''),'/',3) AS ref_host, COALESCE(source,'') AS source, COALESCE(medium,'') AS medium, COALESCE(city,'') AS city, COALESCE(region,'') AS region,
      (COALESCE(user_agent,'') ~* 'FBAN|FBAV') AS facebook_app
    FROM page_views WHERE (visitor_id = ANY($1) OR user_id::text = $2) ORDER BY created_at LIMIT 60`, [ids, String(u.id)]);
  console.log("pages: " + JSON.stringify(pv));
  const ev = await db.query(`SELECT to_char(created_at AT TIME ZONE 'America/Chicago','MM-DD HH24:MI') AS ct, event_name
    FROM funnel_events WHERE (visitor_id = ANY($1) OR user_id::text = $2) ORDER BY created_at LIMIT 80`, [ids, String(u.id)]);
  console.log("events: " + JSON.stringify(ev));
  const rs = await db.query(`SELECT to_char(created_at AT TIME ZONE 'America/Chicago','MM-DD HH24:MI') AS ct, trade, state, matched
    FROM radar_search_log WHERE (visitor_id = ANY($1) OR user_id = $2) AND trade NOT LIKE '%@%' ORDER BY created_at`, [ids, u.id]);
  console.log("searches: " + JSON.stringify(rs));
  const al = await db.query(`SELECT COUNT(*)::int AS n FROM bid_alerts WHERE user_id = $1`, [u.id]).catch(() => [{ n: "n/a" }]);
  console.log("bid alerts set up: " + JSON.stringify(al));
}
