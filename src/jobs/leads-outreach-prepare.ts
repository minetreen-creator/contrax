/**
 * Award Leads outreach — prepare step (`bun run leads-outreach-prepare`), run
 * after the daily bid and prime outreach by .github/workflows/outreach-prepare.yml
 * (owner 2026-10-30: "find me the revenue" → "2,3"). Queues drafts only;
 * nothing is sent until the owner approves the list on /admin/outreach.
 *
 * Who: businesses that sell TO contractors (surety bond agencies, contractor
 * insurance agencies, equipment financing, construction staffing) in the
 * states whose companies won the most federal contracts in the last 30 days
 * (award_leads). The email states that count and dollar total and offers the
 * state's winner list free; the paid product is /leads ($249/month).
 *
 * Without GOOGLE_PLACES_API_KEY nothing is queued.
 */
import { sql } from "~/db";
import { ensureAwardLeadsTable } from "~/lib/award-leads.server";
import { STATE_NAMES } from "~/lib/contract-map";
import { addressState, emailFitsSite, LEADS_BUYERS, leadsHeadline } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueLeadsBuyer } from "~/lib/outreach.server";
import { siteHost } from "~/lib/prospect-finder";
import { searchPlaces, siteEmails } from "./prospect-finder";

/** Award Leads drafts one run may queue. */
const LEADS_DAILY = 12;
/** States looked at per run (busiest first). */
const STATES_PER_RUN = 8;
/** Businesses per buyer type per state. */
const PER_TYPE = 1;

async function busiestStates(): Promise<{ state: string; n: number; total: number }[]> {
  const rows = (await sql()`
    SELECT recipient_state AS state, COUNT(DISTINCT LOWER(recipient_name))::int AS n, COALESCE(SUM(amount), 0)::float AS total
    FROM award_leads
    WHERE awarded_on >= CURRENT_DATE - 30 AND recipient_state ~ '^[A-Z]{2}$'
    GROUP BY 1 HAVING COUNT(*) >= 5
    ORDER BY n DESC`) as { state: string; n: number; total: number }[];
  // Skip states whose businesses were all emailed already, so each run reaches new ones.
  const done = (await sql()`
    SELECT place, COUNT(*)::int AS n FROM outreach_contacts WHERE kind = 'leads' GROUP BY 1`) as { place: string; n: number }[];
  const full = new Set(done.filter((d) => d.n >= LEADS_BUYERS.length * 2).map((d) => d.place));
  return rows.filter((r) => STATE_NAMES[r.state] && !full.has(STATE_NAMES[r.state]!)).slice(0, STATES_PER_RUN);
}

async function main() {
  await ensureOutreach();
  await ensureAwardLeadsTable();
  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key) {
    console.log("GOOGLE_PLACES_API_KEY is not set — no Award Leads emails today.");
    return;
  }
  const states = await busiestStates();
  console.log(`States: ${states.map((s) => `${s.state} (${s.n})`).join(", ") || "none"}`);

  let queued = 0;
  const seenHosts = new Set<string>();
  for (const st of states) {
    if (queued >= LEADS_DAILY) break;
    const stateName = STATE_NAMES[st.state]!;
    const headline = leadsHeadline(st.n, st.total, stateName);
    console.log(`\n${headline}`);
    for (const buyer of LEADS_BUYERS) {
      if (queued >= LEADS_DAILY) break;
      let places;
      try {
        places = await searchPlaces(key, `${buyer.places} in ${stateName}`);
      } catch (e) {
        console.log(`  Places error: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      let forType = 0;
      for (const p of places) {
        if (forType >= PER_TYPE || queued >= LEADS_DAILY) break;
        const host = p.website ? siteHost(p.website) : null;
        if (!p.website || !host || seenHosts.has(host)) continue;
        // Only businesses in the state the list is about.
        if (addressState(p.address) !== st.state) continue;
        seenHosts.add(host);
        const { emails } = await siteEmails(p.website);
        const email = emails.find((e) => emailFitsSite(e, host, p.name));
        if (!email || !(await isNewAddress(email))) continue;
        const ok = await queueLeadsBuyer({ email, business: p.name, website: p.website, headline, place: stateName, tradeLabel: buyer.label });
        if (ok) {
          forType++;
          queued++;
          console.log(`  ✉️ ${buyer.label}: ${p.name} — ${email}`);
        }
      }
    }
  }
  console.log(`\nAward Leads emails queued: ${queued}. Approve them at https://www.contrax.company/admin/outreach`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Award Leads outreach prepare crashed:", e);
      process.exit(1);
    });
}
