/**
 * Account search-profile lookup — CLI entrypoint (`bun run account-search-profile`),
 * run by hand from .github/workflows/account-search-profile.yml (owner
 * 2026-10-19: pull a signed-in visitor's search details for the engineer).
 * Read-only.
 *
 * Homepage and /radar searches only record the event name and the cert, never
 * the trade or state typed in. What the account did save is its onboarding
 * profile (business_profiles), so print that, plus the plan and dates.
 *
 * EMAIL may be a full address or the part before "@" (the admin visitor page
 * shows it cut off, e.g. "dandetruckingservices@…").
 */
import { sql } from "~/db";

export async function accountSearchProfile(email: string): Promise<void> {
  const needle = email.trim().toLowerCase().replace(/@?…?$/, "");
  const pattern = needle.includes("@") ? needle : `${needle}@%`;
  const users = (await sql()`
    SELECT id, email, created_at, plan_tier, subscription_status, trial_started_at, signup_source
    FROM users
    WHERE LOWER(email) LIKE ${pattern}
    ORDER BY id
    LIMIT 5
  `) as Record<string, unknown>[];
  if (!users.length) {
    console.log(`No account found for "${needle}".`);
    return;
  }
  for (const u of users) {
    console.log("👤 Account");
    for (const k of ["email", "created_at", "plan_tier", "subscription_status", "trial_started_at", "signup_source"]) {
      console.log(`  ${k}: ${u[k] ?? "-"}`);
    }
    const profiles = (await sql()`
      SELECT business_name, industry, locations, service_categories, naics_codes, certifications, created_at, updated_at
      FROM business_profiles
      WHERE user_id = ${u.id as number}
      ORDER BY id
    `) as Record<string, unknown>[];
    if (!profiles.length) console.log("  (no business profile saved)");
    for (const p of profiles) {
      console.log("🏢 Business profile");
      for (const [k, v] of Object.entries(p)) {
        console.log(`  ${k}: ${v === null || v === undefined ? "-" : typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v}`);
      }
    }
    // Searches saved from 2026-10-19 on (radar_search_log); none before that.
    try {
      const searches = (await sql()`
        SELECT created_at, trade, state, cert, matched, shown, related
        FROM radar_search_log
        WHERE user_id = ${u.id as number}
        ORDER BY created_at DESC
        LIMIT 25
      `) as Record<string, unknown>[];
      console.log(`🔎 Recent searches (${searches.length})`);
      for (const s of searches) {
        console.log(`  ${s.created_at} | ${s.trade} | ${s.state || "any state"} | ${s.cert} | matches ${s.matched} (shown ${s.shown}) | related ${s.related}`);
      }
    } catch {
      console.log("🔎 Recent searches: none saved yet");
    }
  }
}

if (import.meta.main) {
  try {
    const email = String(process.env.EMAIL ?? "").trim();
    if (!email) throw new Error("EMAIL is required");
    await accountSearchProfile(email);
    process.exit(0);
  } catch (e) {
    console.error("💥 Account search-profile lookup crashed:", e);
    process.exit(1);
  }
}
