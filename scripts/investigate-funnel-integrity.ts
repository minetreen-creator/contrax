/**
 * INVESTIGATE signup='Success' data integrity (owner TOP priority, 09-02).
 *
 * READ-ONLY probe against prod Neon. Pulls every visitors row by signup status,
 * grouped by IP/UA/browser/session, and reconciles against funnel_events /
 * page_views / users. Makes NO writes.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);

  console.log("=== 1. ALL visitors rows (full) ===");
  const all = await db`SELECT * FROM visitors ORDER BY last_seen_at DESC`;
  console.table(
    all.map((r: any) => ({
      visitor_id: r.visitor_id,
      signup: r.signup,
      activated: r.activated,
      radar: r.radar,
      steps: r.steps,
      sessions: r.sessions,
      city: r.city,
      region: r.region,
      device: r.device_type,
      browser: r.browser_label,
      first_ip: r.first_ip,
      last_ip: r.last_ip,
      source: r.source,
      converted_user_id: r.converted_user_id,
      converted_at: r.converted_at ? new Date(r.converted_at).toISOString() : null,
      first_seen: r.first_seen_at ? new Date(r.first_seen_at).toISOString() : null,
      last_seen: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
      first_path: r.first_path,
      last_path: r.last_path,
    })),
  );

  console.log("\n=== 2. Funnel events by visitor_id (all) ===");
  const fe = await db`
    SELECT visitor_id, event_name, created_at, ip, user_agent, user_id, user_email,
           city, region, device_type, browser_label, source, path, id
    FROM funnel_events ORDER BY created_at`;
  console.table(
    fe.map((r: any) => ({
      id: r.id,
      visitor_id: r.visitor_id,
      event: r.event_name,
      at: new Date(r.created_at).toISOString(),
      ip: r.ip,
      ua: r.user_agent,
      user_id: r.user_id,
      user_email: r.user_email,
      city: r.city,
      device: r.device_type,
      browser: r.browser_label,
    })),
  );

  console.log("\n=== 3. page_views by visitor_id (count + ip) ===");
  const pv = await db`
    SELECT visitor_id, COUNT(*) AS cnt, array_agg(DISTINCT ip) AS ips,
           array_agg(DISTINCT user_agent) AS uas
    FROM page_views GROUP BY visitor_id ORDER BY cnt DESC`;
  console.table(pv);

  console.log("\n=== 4. users referenced by converted_user_id ===");
  const converted = all
    .map((r: any) => r.converted_user_id)
    .filter((x: any) => x != null && x !== "");
  if (converted.length) {
    const users = await db`SELECT id, email, plan_tier, trial_started_at, created_at FROM users WHERE id = ANY(${converted})`;
    console.table(users);
  } else {
    console.log("(no converted_user_id on any visitors row)");
  }

  console.log("\n=== 5. All users (for real-signup reconciliation) ===");
  const users = await db`SELECT id, email, plan_tier, trial_started_at, created_at FROM users ORDER BY id`;
  console.table(users.map((u: any) => ({ ...u, created_at: u.created_at ? new Date(u.created_at).toISOString() : null })));

  console.log("\n=== 6. Distinct IPs across funnel_events + page_views ===");
  const ips = await db`
    (SELECT ip, 'funnel' AS tbl FROM funnel_events WHERE ip IS NOT NULL)
    UNION
    (SELECT ip, 'page' AS tbl FROM page_views WHERE ip IS NOT NULL)`;
  console.table(ips);

  console.log("\n=== 7. funnel_events with signup_success ===");
  const succ = await db`SELECT * FROM funnel_events WHERE event_name = 'signup_success' ORDER BY created_at`;
  console.table(
    succ.map((r: any) => ({
      id: r.id,
      visitor_id: r.visitor_id,
      at: new Date(r.created_at).toISOString(),
      ip: r.ip,
      ua: r.user_agent,
      user_id: r.user_id,
      user_email: r.user_email,
      source: r.source,
    })),
  );

  console.log("\n=== 8. Total funnel_events / page_views / radar_saves ===");
  const tot = await db`
    SELECT
      (SELECT COUNT(*) FROM funnel_events) AS funnel,
      (SELECT COUNT(*) FROM page_views) AS page_views,
      (SELECT COUNT(*) FROM radar_saves) AS radar_saves`;
  console.table(tot);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ failed:", e);
    process.exit(1);
  });
