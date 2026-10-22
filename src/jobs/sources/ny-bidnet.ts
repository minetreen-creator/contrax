/**
 * BidNet Direct — "Empire State Purchasing Group" — `ny_bidnet`, the
 * general-procurement bid surface BidNet runs for New York, alongside (never
 * instead of) the state's own board `ny_nyscr` (the New York State Contract
 * Reporter).
 *
 * WHY: every BidNet purchasing group publishes the SAME public, login-free
 * "open bids" list the shared `bidnet-direct.ts` engine already reads for
 * `sd_bidnet`, `nh_bidnet`, `va_bidnet` and `ca_bidnet` (owner 2026-10-22: "can
 * we use the same CA scraper for NY?"). This file is the FIFTH config for that
 * engine: one config object, no new parser, no new dependency, no API key.
 * New York agencies (state, county, city, town, school district, authority)
 * self-post here, including solicitations below NYSCR's $150,000 advertising
 * threshold that never reach NYSCR.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA, no JavaScript, no
 * cookies, no POST):
 *   GET https://www.bidnetdirect.com/new-york/solicitations/open-bids
 * Its heading read `436 Open Solicitations` and its own page selector advertised
 * 18 pages (17 of 25 + a last page of 11). Every row on pages 1 and 2 reads
 * region `New York`. The engine default page cap (`BIDNET_MAX_PAGES`, 40 pages
 * = 1,000 rows) and pass timeout (120 s) cover it with room to grow, so this
 * config sets neither.
 *
 * BOT WALL: BidNet's AWS WAF answered the list GET with an HTTP 202 challenge
 * page on some attempts from this sandbox (a later identical GET returned the
 * list). The engine treats any non-200 as a FAILED pass, never as an empty
 * group, so a challenged run records a failure and the next sync reads again;
 * nothing tries to solve or bypass the challenge.
 *
 * HONESTY — see `bidnet-direct.ts` for the binding contract. In short: BidNet is
 * a THIRD-PARTY aggregator (bidnetdirect.com, not a .gov host; agencies
 * self-post) and is NOT the State of New York's procurement board; only the
 * public, login-free pages are read; the members-only cells (issuing
 * organization, solicitation number, description, source) stay NULL and the
 * description says why; dates come from the source's own text (date-only →
 * 11:59 PM Eastern, the LATE bound); `estimated_value` is "Not specified"; and
 * `category` is Contrax's OWN classification of the title.
 *
 * REGION: the engine stores each row's OWN region text as `location` (`New
 * York`); the source's class is STATE scoped to NY (see `src/lib/source-class.ts`).
 *
 * IDENTITY: `external_id = nybidnet-<BidNet's own solicitation id>`. `ny_nyscr`
 * is a DIFFERENT source and is untouched: the same work republished here is a
 * second publisher's listing and is stored as its own row, exactly as `va_eva`
 * coexists with `va_bidnet`.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NY_BIDNET_SOURCE = "ny_bidnet";
export const NY_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NY_BIDNET_ID_PREFIX = "nybidnet";
/** The engine default: 18 pages held the whole NY group on 2026-10-22. */
export const NY_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NY_BIDNET_AGENCY = "Empire State Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Empire State Purchasing Group. */
export const NY_BIDNET_LIST_URL = `${NY_BIDNET_ORIGIN}/new-york/solicitations/open-bids`;

const NY_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NY_BIDNET_SOURCE,
  idPrefix: NY_BIDNET_ID_PREFIX,
  slug: "new-york",
  stateName: "New York",
  groupName: "Empire State Purchasing Group",
};

const group = createBidNetGroup(NY_BIDNET_CONFIG);

if (group.listUrl !== NY_BIDNET_LIST_URL)
  throw new Error("ny_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NY_BIDNET_AGENCY)
  throw new Error("ny_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the NY list page, exactly as the page prints it. */
export type NyBidnetRow = BidNetRow;
export type NyBidnetParseResult = BidNetParseResult;

export const nyBidnetListShapeOk = group.listShapeOk;
export const nyBidnetStatedOpenCount = group.statedOpenCount;
export const nyBidnetAbsoluteUrl = group.absoluteUrl;
export const parseNyBidnetPageLinks = group.parsePageLinks;
export const nyBidnetDetailId = group.detailId;
export const parseNyBidnetRows = group.parseRows;
export const nyBidnetDueMs = group.dueMs;
export const nyBidnetDateKey = group.dateKey;

/** PURE parse of the NY list rows — no network, no DB; `now` is injected. */
export const parseNyBidnet = group.parse;

/**
 * Read BidNet's public New York open-bids list, following its own pagination,
 * and return one bid per solicitation. ZERO rows is honest-empty, never a
 * failure; a page that lost its shape, a non-200 (including the bot wall's 202
 * challenge), or a heading that claims solicitations the rows did not deliver
 * FAILS instead of reading as empty.
 */
export const fetchNyBidnetBids = group.fetchBids;
