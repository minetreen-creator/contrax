/**
 * Auto-Pilot preview (`bun run autopilot-preview`), read-only (owner 2026-11-09): for the admin
 * account(s) with a business profile (or, when there are none, three sample businesses), the AI reads up to AUTOPILOT_DAILY_CAP open bids added in
 * the past 3 days that match the profile, and the verdicts are printed. Nothing is stored and no
 * email is sent. Prints no email addresses or names. Run from the Actions tab.
 */
import { sql } from "~/db";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { buildDigestMatcher, type DigestProfile } from "~/lib/digest-match";
import { splitDigestBids } from "~/lib/digest-open-to-all";
import { profileList, strongPicks, type AutopilotProfile } from "~/lib/autopilot";
import { autopilotBidsOf } from "~/lib/digest-member";
import { autopilotEnabled, autopilotForMember, newAutopilotBudget } from "~/lib/autopilot.server";

if (!autopilotEnabled()) {
  console.log("OPENAI_API_KEY is not set; nothing to preview.");
  process.exit(0);
}

const bids = (await sql()`
  SELECT id AS bid_id, title, agency, location, due_date, set_aside, description, category, naics_code
  FROM bids
  WHERE created_at > NOW() - INTERVAL '3 days' AND due_date > NOW()
    AND ${sql().unsafe(LOW_CONTENT_SQL)} AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
  ORDER BY due_date ASC
`) as any[];
const members = (await sql()`
  SELECT u.id AS user_id, bp.*
  FROM users u
  JOIN LATERAL (SELECT * FROM business_profiles p WHERE p.user_id = u.id ORDER BY p.id ASC LIMIT 1) bp ON true
  WHERE u.is_admin
`) as (DigestProfile & Record<string, any>)[];
console.log(`${bids.length} open bid(s) added in the past 3 days; ${members.length} admin profile(s).`);
// No admin profile: three made-up sample businesses, so the AI's answers can be judged without
// reading any customer's profile.
if (members.length === 0) {
  console.log("Using three sample businesses (not real customers).");
  members.push(
    { user_id: 0, business_name: "Sample paving contractor", industry: "Construction", service_categories: ["paving", "asphalt", "concrete"], locations: ["VA"], certifications: ["sdvosb"], years_in_business: 6, employee_count: 12, typical_contract_value: "$50K-$500K", past_performance_summary: "Parking lot and road resurfacing for two counties and a school district." },
    { user_id: 0, business_name: "Sample cleaning company", industry: "Janitorial", service_categories: ["janitorial", "custodial", "floor care"], locations: ["NC"], certifications: ["wosb"], years_in_business: 3, employee_count: 8, typical_contract_value: "$20K-$150K", past_performance_summary: "Nightly office cleaning for a hospital clinic and a bank branch." },
    { user_id: 0, business_name: "Sample landscaping firm", industry: "Landscaping", service_categories: ["landscaping", "mowing", "grounds maintenance"], locations: ["TX"], certifications: [], years_in_business: 10, employee_count: 25, typical_contract_value: "$25K-$300K", past_performance_summary: "Mowing and grounds care for a city parks department." },
  );
}

const budget = newAutopilotBudget(36);
let n = 0;
for (const m of members) {
  n++;
  const matcher = buildDigestMatcher(m);
  if (!matcher.personal) {
    console.log(`\nMember ${n}: no trade/states set, skipped.`);
    continue;
  }
  const rows = bids.map((b) => ({
    bid_id: Number(b.bid_id), title: String(b.title ?? ""), agency: String(b.agency ?? ""), location: String(b.location ?? ""),
    due_date: b.due_date ? new Date(b.due_date).toISOString() : null, set_aside: b.set_aside ?? null, description: b.description ?? null,
    match: { title: b.title, description: b.description, category: b.category, location: b.location, agency: b.agency, naics_code: b.naics_code },
  }));
  const { main, openToAll } = splitDigestBids(rows.filter((b) => matcher.matches(b.match)));
  const profile: AutopilotProfile = {
    businessName: m.business_name, industry: m.industry, naicsCodes: profileList(m.naics_codes),
    serviceCategories: profileList(m.service_categories), locations: profileList(m.locations),
    certifications: profileList(m.certifications), licenses: profileList(m.licenses),
    yearsInBusiness: m.years_in_business, employeeCount: m.employee_count, typicalContractValue: m.typical_contract_value,
    pastPerformance: m.past_performance_summary, capabilityStatement: m.capability_statement,
  };
  const all = [...main, ...openToAll];
  console.log(`\nMember ${n} (${matcher.label}; certifications: ${profile.certifications?.join(", ") || "none"}): ${all.length} matching bid(s)`);
  // Same path as the morning job: overseas work is not read.
  const verdicts = await autopilotForMember(Number(m.user_id), profile, autopilotBidsOf(main, openToAll), budget, { store: false });
  const title = new Map(all.map((b) => [b.bid_id, b]));
  for (const v of verdicts) {
    const b = title.get(v.bid_id)!;
    console.log(`  #${v.bid_id} ${v.decision.toUpperCase()} fit ${v.fit} | eligible ${v.eligible} | ${b.title.slice(0, 90)} (${b.set_aside || "no set-aside"})`);
    console.log(`      why: ${v.why}`);
    if (v.missing.length) console.log(`      may need: ${v.missing.join("; ")}`);
  }
  console.log(`  Strong picks for the email: ${strongPicks(verdicts).map((v) => `#${v.bid_id}`).join(", ") || "none"}`);
}
console.log(`\nAI calls: ${budget.calls} (${budget.failures} failed).`);
process.exit(0);
