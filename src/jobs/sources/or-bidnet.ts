/**
 * BidNet Direct — "Oregon Purchasing Group" — `or_bidnet`, the general-procurement bid surface
 * BidNet runs for Oregon, alongside (never instead of) any Oregon state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/oregon/solicitations/open-bids
 * Its heading read `318 Open Solicitations` over 13 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Oregon's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Oregon`) is its
 * `location` (class STATE scoped to OR); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = orbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Oregon board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const OR_BIDNET_SOURCE = "or_bidnet";
export const OR_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const OR_BIDNET_ID_PREFIX = "orbidnet";
/** The engine default; 13 page(s) held the whole group on 2026-10-22. */
export const OR_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const OR_BIDNET_AGENCY = "Oregon Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Oregon Purchasing Group. */
export const OR_BIDNET_LIST_URL = `${OR_BIDNET_ORIGIN}/oregon/solicitations/open-bids`;

const OR_BIDNET_CONFIG: BidNetGroupConfig = {
  source: OR_BIDNET_SOURCE,
  idPrefix: OR_BIDNET_ID_PREFIX,
  slug: "oregon",
  stateName: "Oregon",
  groupName: "Oregon Purchasing Group",
};

const group = createBidNetGroup(OR_BIDNET_CONFIG);

if (group.listUrl !== OR_BIDNET_LIST_URL)
  throw new Error("or_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== OR_BIDNET_AGENCY)
  throw new Error("or_bidnet: agency label does not match BidNet's group name");

export type OrBidnetRow = BidNetRow;
export type OrBidnetParseResult = BidNetParseResult;

export const orBidnetListShapeOk = group.listShapeOk;
export const orBidnetStatedOpenCount = group.statedOpenCount;
export const parseOrBidnetPageLinks = group.parsePageLinks;
export const parseOrBidnetRows = group.parseRows;

/** PURE parse of the Oregon list rows — no network, no DB; `now` is injected. */
export const parseOrBidnet = group.parse;

/** Read BidNet's public Oregon open-bids list, following its own pagination. */
export const fetchOrBidnetBids = group.fetchBids;
