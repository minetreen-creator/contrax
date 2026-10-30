/**
 * Prime-contractor outreach — prepare step (`bun run prime-outreach-prepare`),
 * run after the daily bid outreach by .github/workflows/outreach-prepare.yml
 * (owner 2026-10-30: "We should do primes all over the US" → "first list free,
 * build it"). Queues drafts only; nothing is sent until the owner approves the
 * list on /admin/outreach.
 *
 * Who: companies that won a federal service contract (janitorial, grounds,
 * guards, pest, building and facilities maintenance, waste, HVAC) in the last
 * 21 days in a DIFFERENT state from where they are based (award_leads, synced
 * from USAspending each weekday). They usually need a local subcontractor
 * there. Google Places finds the company by name and home town; its website
 * gives the email it publishes. The email offers a free list of local
 * companies in that trade near the work.
 *
 * Without GOOGLE_PLACES_API_KEY nothing is queued.
 */
import { sql } from "~/db";
import { ensureAwardLeadsTable } from "~/lib/award-leads.server";
import { STATE_NAMES } from "~/lib/contract-map";
import { emailFitsSite, PRIME_MIN_AMOUNT, PRIME_TRADES, primeAwardFits, sameCompany } from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queuePrime } from "~/lib/outreach.server";
import { siteHost } from "~/lib/prospect-finder";
import { searchPlaces, siteEmails } from "./prospect-finder";

/** Prime drafts one run may queue. */
const PRIME_DAILY = 20;
/** How far back an award counts as recent. */
const RECENT_DAYS = 21;

interface AwardRow {
  id: number;
  recipient_name: string;
  recipient_city: string | null;
  recipient_state: string | null;
  pop_state: string | null;
  amount: number;
  agency: string | null;
  sub_agency: string | null;
  description: string | null;
  naics_code: string | null;
}

async function recentAwards(): Promise<AwardRow[]> {
  const codes = Object.keys(PRIME_TRADES);
  const rows = (await sql()`
    SELECT id, recipient_name, recipient_city, recipient_state, pop_state, amount, agency, sub_agency, description, naics_code
    FROM award_leads
    WHERE awarded_on >= CURRENT_DATE - ${`${RECENT_DAYS} days`}::interval
      AND naics_code = ANY(${codes})
      AND amount >= ${PRIME_MIN_AMOUNT}
      AND pop_state IS NOT NULL AND recipient_state IS NOT NULL AND pop_state <> recipient_state
      AND NOT EXISTS (
        SELECT 1 FROM outreach_contacts c WHERE c.kind = 'prime' AND LOWER(c.business) = LOWER(award_leads.recipient_name)
      )
    ORDER BY awarded_on DESC, amount DESC
    LIMIT 120`) as AwardRow[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

async function main() {
  await ensureOutreach();
  await ensureAwardLeadsTable();
  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key) {
    console.log("GOOGLE_PLACES_API_KEY is not set — no prime emails today.");
    return;
  }
  const awards = (await recentAwards()).filter(primeAwardFits);
  console.log(`Recent out-of-state service awards: ${awards.length}`);

  let queued = 0;
  const seen = new Set<string>();
  for (const a of awards) {
    if (queued >= PRIME_DAILY) break;
    const who = a.recipient_name.trim().toLowerCase();
    if (seen.has(who)) continue;
    seen.add(who);
    const trade = PRIME_TRADES[a.naics_code!]!.label;
    const place = STATE_NAMES[a.pop_state!] ?? a.pop_state!;
    const query = [a.recipient_name, a.recipient_city, a.recipient_state].filter(Boolean).join(" ");
    console.log(`  ${a.recipient_name} (${a.recipient_city ?? "?"}, ${a.recipient_state}) won ${trade} work in ${place}, $${a.amount.toLocaleString("en-US")}`);
    let places;
    try {
      places = await searchPlaces(key, query);
    } catch (e) {
      console.log(`    Places error: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // Only the awarded company itself: a Places hit must share its name.
    const p = places.find((x) => x.website && sameCompany(a.recipient_name, x.name));
    if (!p?.website) {
      console.log("    no matching business with a website");
      continue;
    }
    const host = siteHost(p.website);
    const { emails } = await siteEmails(p.website);
    const email = emails.find((e) => emailFitsSite(e, host, p.name));
    if (!email) {
      console.log(`    no usable email on ${p.website}`);
      continue;
    }
    if (!(await isNewAddress(email))) continue;
    const ok = await queuePrime({
      email,
      business: a.recipient_name,
      website: p.website,
      awardId: a.id,
      description: a.description ?? `${trade} services`,
      agency: a.sub_agency ?? a.agency,
      place,
      tradeLabel: trade,
    });
    if (ok) {
      queued++;
      console.log(`    ✉️ ${p.name} — ${email}`);
    }
  }
  console.log(`\nPrime emails queued: ${queued}. Approve them at https://www.contrax.company/admin/outreach`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Prime outreach prepare crashed:", e);
      process.exit(1);
    });
}
