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
 * Without a working GOOGLE_PLACES_API_KEY the businesses come from the
 * contractor registry (sam_registrants) instead, at no cost (owner 2026-11-14).
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import {
  addressState,
  BUSINESSES_PER_BID,
  DAILY_CONTRACTOR_FIRST_EMAILS,
  DAILY_FIRST_EMAILS,
  bidFitsTrade,
  bidIsServiceJob,
  bidNeedsPrequalification,
  constructionOutreachTrade,
  federalConstructionJob,
  emailFitsSite,
  MAX_DAYS_TO_DUE,
  MIN_DAYS_TO_DUE,
  OUTREACH_TRADES,
  placeIsLocal,
  type OutreachTrade,
} from "~/lib/outreach";
import { isConstructionNonWork, isConstructionTitle } from "~/lib/trade-classification";
import { resolveSourceClass } from "~/lib/source-class";
import { ensureOutreach, isNewAddress, queueFirst, queueFollowups, queuePack, recheckWaitingDrafts, skipAllDrafts } from "~/lib/outreach.server";
import { bidPlace, placesQuery, siteHost } from "~/lib/prospect-finder";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { findBusinesses, siteEmails } from "./prospect-finder";

/** Bids looked at per trade per day; spreads the 30 drafts across trades. A
 *  "more" run (owner 2026-10-30: "do 25 more") looks at twice as many. */
const BIDS_PER_TRADE = process.env.MORE_DRAFTS === "true" ? 6 : 3;
/** How recently a bid must have been saved to count as fresh. The daily run
 *  keeps 3 days; a "more" run reaches back 10 so it isn't left with nothing. */
const FRESH_DAYS = process.env.MORE_DRAFTS === "true" ? 10 : 3;
/** Candidates read per trade before the "is this local?" filter. */
const CANDIDATES_PER_TRADE = 25;
/**
 * Focus run (owner 2026-11-04: "draft outreach emails for tomorrow" → "and
 * concentrate on VA construction"): FOCUS_STATE=VA FOCUS_TRADE=construction
 * queues the day's first emails for that state's open construction bids only.
 */
const FOCUS_STATE = (process.env.FOCUS_STATE ?? "").trim().toUpperCase();
const FOCUS_TRADE = (process.env.FOCUS_TRADE ?? "").trim().toLowerCase();
/**
 * FOCUS_OFFER=pack (owner 2026-11-14): a construction focus run queues the free
 * Bid Pack offer in place of the usual first email.
 */
const FOCUS_OFFER = (process.env.FOCUS_OFFER ?? "").trim().toLowerCase();
/** A focus run reaches back further: one state's fresh construction bids are fewer. */
const FOCUS_FRESH_DAYS = 10;

interface BidRow {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  normalized_state: string;
  due_date: Date | string;
  description?: string | null;
  source?: string | null;
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
      AND created_at >= NOW() - ${`${FRESH_DAYS} days`}::interval
      AND LOWER(title) LIKE ${like}
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
      AND NOT EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.bid_id = bids.id)
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as BidRow[];
}

/**
 * One state's open bids for one outreach trade (owner 2026-11-14: "matched-bid
 * emails to 30 Virginia janitorial firms"). A state has few such bids at a time
 * (Virginia had three), so a focus run takes every open one, whenever it was
 * saved and whether or not it was used before; known addresses are still skipped.
 */
async function stateTradeBids(match: string, state: string, limit: number): Promise<BidRow[]> {
  const s = sql();
  const like = `%${match.toLowerCase()}%`;
  return (await s`
    SELECT id, title, agency, location, normalized_state, due_date FROM bids
    WHERE normalized_state = ${state}
      AND due_date >= NOW() + ${`${MIN_DAYS_TO_DUE} days`}::interval
      AND due_date <= NOW() + ${`${MAX_DAYS_TO_DUE} days`}::interval
      AND LOWER(title) LIKE ${like}
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
    ORDER BY due_date ASC
    LIMIT ${limit}
  `) as BidRow[];
}

/** One state's fresh open construction bids, newest first. */
async function freshConstructionBids(state: string, limit: number): Promise<BidRow[]> {
  const s = sql();
  return (await s`
    SELECT id, title, agency, location, normalized_state, due_date, description, source FROM bids
    WHERE normalized_state = ${state}
      AND category = 'Construction'
      AND due_date >= NOW() + ${`${MIN_DAYS_TO_DUE} days`}::interval
      AND due_date <= NOW() + ${`${MAX_DAYS_TO_DUE} days`}::interval
      AND created_at >= NOW() - ${`${FOCUS_FRESH_DAYS} days`}::interval
      AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
      AND NOT EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.bid_id = bids.id)
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as BidRow[];
}

/** Find up to BUSINESSES_PER_BID local businesses for one bid and queue a draft to each. */
async function queueForBid(key: string, b: BidRow, trade: OutreachTrade, seenHosts: Set<string>, room: number, perBid = BUSINESSES_PER_BID): Promise<number> {
  const due = new Date(b.due_date).toISOString().slice(0, 10);
  const place = outreachPlace(b)!;
  const query = placesQuery(trade.places, place);
  console.log(`  #${b.id} ${b.title} (${b.agency ?? "-"}, due ${due}) → ${query}`);
  // Google Places when its key works, else the contractor registry (owner 2026-11-14).
  // Fewer than half of registry firms publish a usable email, so read three candidates per wanted draft.
  const { places, source } = await findBusinesses(key, query, { state: b.normalized_state, label: trade.label, place, bidId: b.id, limit: Math.max(10, perBid * 3) });
  if (source === "registry") console.log(`    ${places.length} from the contractor registry`);
  let forBid = 0;
  for (const p of places) {
    if (forBid >= perBid || forBid >= room) break;
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
    const ok = await (FOCUS_OFFER === "pack" && FOCUS_STATE ? queuePack : queueFirst)({
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
      console.log(`    ✉️ ${p.name} — ${email}`);
    }
  }
  return forBid;
}

/** The focus run: one state's construction bids, each to the contractors its title names. */
async function queueConstructionFocus(key: string, state: string): Promise<number> {
  const bids = (await freshConstructionBids(state, 200)).filter(
    (b) =>
      bidIsServiceJob(b.title) &&
      !isConstructionNonWork(b.title) &&
      !bidNeedsPrequalification(b.agency, b.description) &&
      (resolveSourceClass(b.source ?? "") !== "federal" || federalConstructionJob(b.title, isConstructionTitle)) &&
      outreachPlace(b) !== null,
  );
  console.log(`\n${state} construction: ${bids.length} fresh local bid(s)`);
  let queued = 0;
  const seenHosts = new Set<string>();
  for (const b of bids) {
    if (queued >= DAILY_FIRST_EMAILS) break;
    queued += await queueForBid(key, b, constructionOutreachTrade(b.title), seenHosts, DAILY_FIRST_EMAILS - queued);
  }
  return queued;
}

/** Businesses per bid on a one-trade focus run: a state's few bids have to carry the whole batch. */
const FOCUS_BUSINESSES_PER_BID = 10;

/** The focus run for a service trade: one state's open bids in that trade, up to ten businesses each. */
async function queueTradeFocus(key: string, state: string, trade: OutreachTrade): Promise<number> {
  const bids = (await stateTradeBids(trade.match, state, CANDIDATES_PER_TRADE)).filter(
    (b) => bidIsServiceJob(b.title) && bidFitsTrade(trade.label, b.title) && outreachPlace(b) !== null,
  );
  console.log(`\n${state} ${trade.label}: ${bids.length} open local bid(s)`);
  let queued = 0;
  const seenHosts = new Set<string>();
  for (const b of bids) {
    if (queued >= DAILY_FIRST_EMAILS) break;
    queued += await queueForBid(key, b, trade, seenHosts, DAILY_FIRST_EMAILS - queued, FOCUS_BUSINESSES_PER_BID);
  }
  return queued;
}

async function main() {
  await ensureOutreach();
  if (process.env.RESET_DRAFTS === "true") {
    const n = await skipAllDrafts("reset by owner run");
    console.log(`Reset: ${n} waiting draft(s) skipped.`);
  }
  // Waiting drafts are checked again against today's rules (owner 2026-10-29).
  const dropped = await recheckWaitingDrafts(console.log);
  if (dropped) console.log(`Waiting drafts skipped by today's rules: ${dropped}`);

  const followups = await queueFollowups();
  console.log(`Follow-ups queued: ${followups}`);

  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!key) console.log("GOOGLE_PLACES_API_KEY is not set — finding businesses in the contractor registry.");

  if (FOCUS_STATE && FOCUS_TRADE) {
    const serviceTrade = OUTREACH_TRADES.find((t) => t.match === FOCUS_TRADE || t.label.toLowerCase() === FOCUS_TRADE);
    if (FOCUS_OFFER && (FOCUS_OFFER !== "pack" || FOCUS_TRADE !== "construction")) {
      throw new Error(`Unknown offer "${FOCUS_OFFER}": the only offer is "pack", with trade "construction"`);
    }
    if (!/^[A-Z]{2}$/.test(FOCUS_STATE) || (FOCUS_TRADE !== "construction" && !serviceTrade)) {
      throw new Error(`Unknown focus ${FOCUS_STATE} ${FOCUS_TRADE}: use a two-letter state and "construction" or an outreach trade such as "janitorial"`);
    }
    const queued =
      FOCUS_TRADE === "construction" ? await queueConstructionFocus(key, FOCUS_STATE) : await queueTradeFocus(key, FOCUS_STATE, serviceTrade!);
    console.log(`\nFirst emails queued (${FOCUS_STATE} ${FOCUS_TRADE}): ${queued}. Approve them at https://www.contrax.company/admin/outreach`);
    return;
  }

  // Owner 2026-11-14: the daily run no longer emails small contractors.
  if (DAILY_CONTRACTOR_FIRST_EMAILS <= 0) {
    console.log("\nDaily contractor first emails are off (0 a day). Use a focus run (state + trade) for a deliberate batch.");
    return;
  }
  let queued = 0;
  const seenHosts = new Set<string>();
  for (const trade of OUTREACH_TRADES) {
    if (queued >= DAILY_CONTRACTOR_FIRST_EMAILS) break;
    // Only bids whose place is a real town, county or agency: a statewide
    // purchasing group or a bare state name would make "near you" untrue.
    const bids = (await freshBids(trade.match, CANDIDATES_PER_TRADE))
      .filter((b) => bidIsServiceJob(b.title) && bidFitsTrade(trade.label, b.title) && outreachPlace(b) !== null)
      .slice(0, BIDS_PER_TRADE);
    console.log(`\n${trade.label}: ${bids.length} fresh local bid(s)`);
    for (const b of bids) {
      if (queued >= DAILY_CONTRACTOR_FIRST_EMAILS) break;
      queued += await queueForBid(key, b, trade, seenHosts, DAILY_CONTRACTOR_FIRST_EMAILS - queued);
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
