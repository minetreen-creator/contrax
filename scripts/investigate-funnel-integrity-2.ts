/**
 * FOCUSED funnel-integrity follow-up (read-only): the grouped evidence table
 * for signup=Success/Abandoned/Viewed visitors + signup_success reconciliation.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = neon(process.env.DATABASE_URL);

  console.log("=== A. visitors with signup != 'Not started' (grouped) ===");
  const v = await db`
    SELECT v.visitor_id, v.signup, v.activated, v.radar, v.steps, v.sessions,
           v.first_ip, v.last_ip, v.city, v.region, v.device_type, v.browser_label,
           v.source, v.converted_user_id, v.converted_at,
           v.first_seen_at, v.last_seen_at, v.first_path, v.last_path,
           (SELECT COUNT(*) FROM funnel_events f WHERE f.visitor_id = v.visitor_id) AS funnel_rows,
           (SELECT COUNT(*) FROM page_views p WHERE p.visitor_id = v.visitor_id) AS page_rows
    FROM visitors v
    WHERE v.signup IN ('Success','Abandoned','Viewed')
    ORDER BY v.last_seen_at`;
  for (const r of v) {
    console.log(
      `vid=${r.visitor_id} | signup=${r.signup} | act=${r.activated} | radar=${r.radar} | ` +
        `steps=${r.steps} | sess=${r.sessions} | ip=${r.first_ip}/${r.last_ip} | ` +
        `city=${r.city ?? "-"},${r.region ?? "-"} | ${r.device_type ?? "-"} · ${r.browser_label ?? "-"} | ` +
        `src=${r.source ?? "-"} | converted=${r.converted_user_id ?? "-"}@${r.converted_at ? new Date(r.converted_at).toISOString() : "-"} | ` +
        `first=${r.first_seen_at ? new Date(r.first_seen_at).toISOString() : "-"} | last=${r.last_seen_at ? new Date(r.last_seen_at).toISOString() : "-"} | ` +
        `funnel_rows=${r.funnel_rows} | page_rows=${r.page_rows}`,
    );
  }

  console.log("\n=== B. funnel_events for the Success/Abandoned/Viewed visitor ids ===");
  const ids = v.map((r: any) => r.visitor_id);
  if (ids.length) {
    const fe = await db`
      SELECT visitor_id, event_name, created_at, ip, user_id, user_email, id
      FROM funnel_events WHERE visitor_id = ANY(${ids}) ORDER BY created_at`;
    for (const r of fe) {
      console.log(
        `${new Date(r.created_at).toISOString()} | id=${r.id} | vid=${r.visitor_id} | ${r.event_name} | ` +
          `ip=${r.ip ?? "-"} | user=${r.user_id ?? "-"}/${r.user_email ?? "-"}`,
      );
    }
  } else {
    console.log("(no ids)");
  }

  console.log("\n=== C. All signup_success funnel events: identity + visit_id ===");
  const ss = await db`
    SELECT id, visitor_id, visit_id, created_at, ip, user_id, user_email, source
    FROM funnel_events WHERE event_name = 'signup_success' ORDER BY created_at`;
  for (const r of ss) {
    console.log(
      `id=${r.id} | ${new Date(r.created_at).toISOString()} | vid=${r.visitor_id ?? "-"} | ` +
        `visit=${r.visit_id ?? "-"} | ip=${r.ip ?? "-"} | user=${r.user_id ?? "-"}/${r.user_email ?? "-"} | src=${r.source ?? "-"}`,
    );
  }

  console.log("\n=== D. funnel_events row 792 still exists? + any funnel rows for b29c74f0/de3c52b0/fc8b3e60 ===");
  const d1 = await db`SELECT id, event_name, visitor_id, created_at, ip FROM funnel_events WHERE id = 792`;
  console.log("792:", d1.length ? JSON.stringify(d1[0]) : "GONE (already deleted)");
  const target = ["b29c74f0-e2db-47d5-ba0b-668d8797f3a8", "de3c52b0-fb74-4a5b-91c4-0be905f7f026", "fc8b3e60-96a3-4e06-ae29-57a6b87518a4"];
  const d2 = await db`SELECT id, event_name, visitor_id, created_at, ip, user_id, user_email FROM funnel_events WHERE visitor_id = ANY(${target}) ORDER BY created_at`;
  for (const r of d2) console.log(`  funnel id=${r.id} | ${r.event_name} | vid=${r.visitor_id} | ip=${r.ip} | user=${r.user_id}/${r.user_email}`);
  if (!d2.length) console.log("  (no funnel rows for the 3 Success visitors)");

  console.log("\n=== E. users count + REAL (non-test) signup source of truth ===");
  const users = await db`SELECT id, email, is_admin, plan_tier FROM users ORDER BY id`;
  for (const u of users) {
    const real = !String(u.email).toLowerCase().endsWith("@test.contrax") && !u.is_admin && String(u.email).toLowerCase() !== "demo@contrax.company";
    console.log(`user id=${u.id} | ${u.email} | admin=${u.is_admin} | plan=${u.plan_tier} | REAL=${real}`);
  }
  const realUsers = users.filter(
    (u: any) => !String(u.email).toLowerCase().endsWith("@test.contrax") && !u.is_admin && String(u.email).toLowerCase() !== "demo@contrax.company",
  );
  console.log(`REAL (non-test, non-admin, non-demo) users total: ${realUsers.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ failed:", e);
    process.exit(1);
  });