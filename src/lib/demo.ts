import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { sql } from "~/db";
import { SESSION_COOKIE } from "~/lib/auth";

const DEMO_EMAIL = "demo@contrax.company";
const sampleBids = [
  ["Virginia DOT — I-95 Bridge Rehabilitation", "Virginia Department of Transportation", "Bridge repair and concrete rehabilitation for I-95 corridor.", "Richmond, VA", "Construction", "2026-08-18", "$1.2M"],
  ["GSA Region 3 — Federal Building Renovation", "General Services Administration", "Interior renovation and accessibility upgrades for a federal facility.", "Washington, DC", "Construction", "2026-08-28", "$680K"],
  ["NAVFAC — Base Facility Maintenance", "NAVFAC Mid-Atlantic", "Multi-trade facility maintenance and minor construction services.", "Norfolk, VA", "Facilities", "2026-08-12", "$2M"],
  ["VA Medical Center — Site Improvements", "Department of Veterans Affairs", "Site, paving, drainage, and utility improvements at a medical campus.", "Baltimore, MD", "Construction", "2026-09-10", "$475K"],
  ["USDA — Regional Office Accessibility Updates", "USDA Rural Development", "Accessibility improvements and energy-efficient building updates.", "Harrisonburg, VA", "Construction", "2026-08-22", "$210K"],
  ["HHS — Community Health Center Buildout", "Department of Health and Human Services", "Buildout of clinical and administrative space for a community health center.", "Alexandria, VA", "Construction", "2026-09-25", "$895K"],
  ["Maryland DOT — Stormwater Improvements", "Maryland Department of Transportation", "Stormwater management and erosion control improvements.", "Frederick, MD", "Environmental", "2026-08-15", "$155K"],
  ["Fort Belvoir — Roofing Replacement", "U.S. Army Corps of Engineers", "Roof replacement and envelope repairs across three structures.", "Fort Belvoir, VA", "Construction", "2026-08-08", "$320K"],
  ["DC Public Buildings — Electrical Modernization", "DC Department of General Services", "Electrical distribution and emergency power modernization.", "Washington, DC", "Electrical", "2026-10-02", "$740K"],
  ["USDA Forest Service — Visitor Center Repairs", "USDA Forest Service", "Repair and improve visitor center facilities and site infrastructure.", "Front Royal, VA", "Construction", "2026-09-04", "$95K"],
  ["VA — Patient Parking Expansion", "Department of Veterans Affairs", "Parking expansion, lighting, and pedestrian safety improvements.", "Martinsburg, WV", "Construction", "2026-10-15", "$1.7M"],
  ["GSA — Small Project Indefinite Delivery Contract", "General Services Administration", "IDIQ contract for recurring small construction projects.", "Washington, DC", "Construction", "2026-11-06", "$500K"],
  ["NAVFAC — Warehouse Demolition and Rebuild", "NAVFAC Washington", "Demolition and replacement of an aging warehouse structure.", "Quantico, VA", "Construction", "2026-09-18", "$1.4M"],
];

export const ensureDemoSession = createServerFn({ method: "GET" }).handler(async () => {
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(crypto.randomUUID()));
  const passwordHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  const users = await sql()`INSERT INTO users (email, password_hash, plan_tier, subscription_status) VALUES (${DEMO_EMAIL}, ${passwordHash}, 'demo', 'active') ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id, email, created_at`;
  const user = users[0] as any;
  const profileCount = await sql()`SELECT COUNT(*)::int AS count FROM business_profiles WHERE user_id=${user.id}`;
  if (Number((profileCount[0] as any)?.count || 0) === 0) await sql()`INSERT INTO business_profiles (user_id,business_name,industry,locations,service_categories,naics_codes,certifications,years_in_business,employee_count,past_performance_summary,specialties,typical_contract_value) VALUES (${user.id},'GreenScape Construction','Construction',${JSON.stringify(["Virginia","Maryland","Washington, DC"]) }::jsonb,${JSON.stringify(["General Construction","Commercial Renovation","Concrete & Masonry","Facilities Maintenance","Site Work","Electrical"]) }::jsonb,${JSON.stringify(["236220"]) }::jsonb,${JSON.stringify(["Woman-Owned Small Business","Small Business"]) }::jsonb,8,15,'Completed municipal and federal facility renovations, site work, and maintenance projects with a strong record of on-time delivery.','$1M+ in completed commercial and public-sector projects',${"$50K-$250K"})`;
  const existing = await sql()`SELECT COUNT(*)::int AS count FROM bids WHERE source = 'contrax-demo'`;
  if (Number((existing[0] as any)?.count || 0) === 0) {
    for (const b of sampleBids) await sql()`INSERT INTO bids (title,agency,description,location,category,due_date,estimated_value,source,external_id) VALUES (${b[0]},${b[1]},${b[2]},${b[3]},${b[4]},${b[5]},${b[6]},'contrax-demo',${`demo-${sampleBids.indexOf(b) + 1}`}) ON CONFLICT DO NOTHING`;
  }
  const bids = await sql()`SELECT id,title,agency,due_date FROM bids WHERE source='contrax-demo' ORDER BY id LIMIT 4`;
  for (const b of bids) await sql()`INSERT INTO saved_matches (user_id,bid_id,status) VALUES (${user.id},${b.id},'saved') ON CONFLICT DO NOTHING`;
  const token = crypto.randomUUID();
  await sql()`DELETE FROM sessions WHERE user_id=${user.id}`;
  await sql()`INSERT INTO sessions (user_id,token,expires_at) VALUES (${user.id},${token},NOW()+INTERVAL '2 days')`;
  setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2 * 24 * 60 * 60 });
  return { success: true };
});
