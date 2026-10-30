/**
 * Daily bid outreach — prepare step (`bun run outreach-prepare`), run each
 * weekday morning by .github/workflows/outreach-prepare.yml (owner
 * 2026-10-23). Queues drafts only; nothing is sent until the owner approves
 * the list on /admin/outreach (see src/lib/outreach.ts).
 *
 *  1. Follow-ups: first emails sent 4+ days ago whose bid is still open.
 *  2. First emails: for each outreach trade, the freshest open bids (saved in
 *     the last 3 days, due 10+ days out) in a US state; Google Places finds
 *     local businesses in that trade and each one's website gives the email
 *     it publishes. Up to 2 new businesses per bid, 30 drafts a day in all.
 *
 * Without GOOGLE_PLACES_API_KEY only step 1 runs.
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import {
  addressState,
  BUSINESSES_PER_BID,
  DAILY_FIRST_EMAILS,
  bidIsServiceJob,
  emailFitsSite,
  MAX_DAYS_TO_DUE,
  MIN_DAYS_TO_DUE,
  OUTREACH_TRADES,
  placeIsLocal,
} from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueFirst, queueFollowups, skipAllDrafts, skipDraft } from "~/lib/outreach.server";
import { bidPlace, placesQuery, siteHost } from "~/lib/prospect-finder";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { searchPlaces, siteEmails } from "./prospect-finder";

/** Bids looked at per trade per day; spreads the 30 drafts across trades. */
const BIDS_PER_TRADE = 3;
/** Candidates read per trade before the "is this local?" filter. */
const CANDIDATES_PER_TRADE = 25;

interface BidRow {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  normalized_state: string;
  due_date: Date | string;
}

/**
 * Where to look for businesses near a bid: its location when that names a
 * town or county, else the buyer ("City of Huntsville, TX") unless the buyer
 * is a statewide purchasing group; null when neither is local.
 */
function outreachPlace(b: BidRow): string | null {
  const loc = (b.location ?? "").trim();
  if (placeIsLocal(loc)) return bidPlace(loc, null, b.normalized_state);
  const agency = (b.agency ?? "").trim();
  if (agency && placeIsLocal(agency)) return `${agency}, ${b.normalized_state}`;
  return null;
}

async function freshBids(match: string, limit: number): Promise<BidRow[]> {
  const s = sql();
  const like = `%${match.toLowerCase()}%`;
  return (await s`
    SELECT id, title, agency, location, normalized_state, due_date FROM bids
    WHERE normalized_state ~ '^[A-Z]{2}$'
      AND due_date >= NOW() + ${`${MIN_DAYS_TO_DUE} days`}::interval
      AND due_date <= NOW() + ${`${MAX_DAYS_TO_DUE} days`}::interval
      AND created_at >= NOW() - INTERVAL '3 days'
      AND LOWER(title) LIKE ${like}
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
      AND NOT EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.bid_id = bids.id)
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as BidRow[];
}

async function main() {
  await ensureOutreach();
  if (process.env.RESET_DRAFTS === "true") {
    const n = await skipAllDrafts("reset by owner run");
    console.log(`Reset: ${n} waiting draft(s) skipped.`);
  }
  // Waiting first emails are checked again against today's rules, so a draft
  // queued before a rule existed (owner 2026-10-29: a placeholder address, an
  // invitational bid) never reaches the send list.
  const waiting = (await sql()`
    SELECT id, email, website, business, bid_title FROM outreach_contacts
    WHERE status = 'draft' AND kind = 'first'
  `) as { id: number; email: string; website: string | null; business: string; bid_title: string }[];
  let dropped = 0;
  for (const d of waiting) {
    const host = d.website ? siteHost(d.website) : null;
    if (bidIsServiceJob(d.bid_title) && emailFitsSite(d.email, host, d.business)) continue;
    await skipDraft(d.id);
    dropped++;
    console.log(`Skipped waiting draft #${d.id}: ${d.business} <${d.email}> — ${d.bid_title}`);
  }
  if (dropped) console.log(`Waiting drafts skipped by today's rules: ${dropped}`);

  const followups = await queueFollowups();
  console.log(`Follow-ups queued: ${followups}`);

  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key) {
    console.log("GOOGLE_PLACES_API_KEY is not set — no new first emails today.");
    return;
  }

  let queued = 0;
  const seenHosts = new Set<string>();
  for (const trade of OUTREACH_TRADES) {
    if (queued >= DAILY_FIRST_EMAILS) break;
    // Only bids whose place is a real town, county or agency: a statewide
    // purchasing group or a bare state name would make "near you" untrue.
    const bids = (await freshBids(trade.match, CANDIDATES_PER_TRADE))
      .filter((b) => bidIsServiceJob(b.title) && outreachPlace(b) !== null)
      .slice(0, BIDS_PER_TRADE);
    console.log(`\n${trade.label}: ${bids.length} fresh local bid(s)`);
    for (const b of bids) {
      if (queued >= DAILY_FIRST_EMAILS) break;
      const due = new Date(b.due_date).toISOString().slice(0, 10);
      const query = placesQuery(trade.places, outreachPlace(b)!);
      console.log(`  #${b.id} ${b.title} (${b.agency ?? "-"}, due ${due}) → ${query}`);
      let places;
      try {
        places = await searchPlaces(key, query);
      } catch (e) {
        console.log(`    Places error: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      let forBid = 0;
      for (const p of places) {
        if (forBid >= BUSINESSES_PER_BID || queued >= DAILY_FIRST_EMAILS) break;
        const host = p.website ? siteHost(p.website) : null;
        if (!p.website || !host || seenHosts.has(host)) continue;
        // A business in another state is not "near" the job (owner 2026-10-30:
        // a Nashville HVAC firm matched to a Warner Robins, GA job).
        const placeState = addressState(p.address);
        if (placeState && placeState !== b.normalized_state) {
          console.log(`    skipped ${p.name}: in ${placeState}, job in ${b.normalized_state}`);
          continue;
        }
        seenHosts.add(host);
        const { emails } = await siteEmails(p.website);
        const email = emails.find((e) => emailFitsSite(e, host, p.name));
        if (!email || !(await isNewAddress(email))) continue;
        const ok = await queueFirst({
          email,
          business: p.name,
          website: p.website,
          bidId: b.id,
          bidTitle: b.title,
          buyer: b.agency,
          due,
          tradeLabel: trade.label,
        });
        if (ok) {
          forBid++;
          queued++;
          console.log(`    ✉️ ${p.name} — ${email}`);
        }
      }
    }
  }
  console.log(`\nFirst emails queued: ${queued}. Approve them at https://www.contrax.company/admin/outreach`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Outreach prepare crashed:", e);
      process.exit(1);
    });
}
