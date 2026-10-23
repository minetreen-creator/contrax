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
  BUSINESSES_PER_BID,
  DAILY_FIRST_EMAILS,
  MIN_DAYS_TO_DUE,
  OUTREACH_TRADES,
} from "~/lib/outreach";
import { ensureOutreach, isNewAddress, queueFirst, queueFollowups } from "~/lib/outreach.server";
import { bidPlace, placesQuery, siteHost } from "~/lib/prospect-finder";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { searchPlaces, siteEmails } from "./prospect-finder";

/** Bids looked at per trade per day; spreads the 30 drafts across trades. */
const BIDS_PER_TRADE = 3;

interface BidRow {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  normalized_state: string;
  due_date: Date | string;
}

async function freshBids(match: string, limit: number): Promise<BidRow[]> {
  const s = sql();
  const like = `%${match.toLowerCase()}%`;
  return (await s`
    SELECT id, title, agency, location, normalized_state, due_date FROM bids
    WHERE normalized_state ~ '^[A-Z]{2}$'
      AND due_date >= NOW() + ${`${MIN_DAYS_TO_DUE} days`}::interval
      AND created_at >= NOW() - INTERVAL '3 days'
      AND (LOWER(title) LIKE ${like} OR LOWER(COALESCE(description, '')) LIKE ${like})
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
      AND NOT EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.bid_id = bids.id)
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as BidRow[];
}

async function main() {
  await ensureOutreach();
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
    const bids = await freshBids(trade.match, BIDS_PER_TRADE);
    console.log(`\n${trade.label}: ${bids.length} fresh bid(s)`);
    for (const b of bids) {
      if (queued >= DAILY_FIRST_EMAILS) break;
      const due = new Date(b.due_date).toISOString().slice(0, 10);
      const query = placesQuery(trade.places, bidPlace(b.location, b.agency, b.normalized_state));
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
        seenHosts.add(host);
        const { emails } = await siteEmails(p.website);
        const email = emails[0];
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
