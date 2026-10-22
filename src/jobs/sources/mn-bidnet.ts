/**
 * BidNet Direct — "Minnesota Purchasing Group" — `mn_bidnet`, the general-procurement bid surface
 * BidNet runs for Minnesota, alongside (never instead of) any Minnesota state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/minnesota/solicitations/open-bids
 * Its heading read `355 Open Solicitations` over 15 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Minnesota's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Minnesota`) is its
 * `location` (class STATE scoped to MN); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mnbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Minnesota board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MN_BIDNET_SOURCE = "mn_bidnet";
export const MN_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MN_BIDNET_ID_PREFIX = "mnbidnet";
/** The engine default; 15 page(s) held the whole group on 2026-10-22. */
export const MN_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MN_BIDNET_AGENCY = "Minnesota Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Minnesota Purchasing Group. */
export const MN_BIDNET_LIST_URL = `${MN_BIDNET_ORIGIN}/minnesota/solicitations/open-bids`;

const MN_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MN_BIDNET_SOURCE,
  idPrefix: MN_BIDNET_ID_PREFIX,
  slug: "minnesota",
  stateName: "Minnesota",
  groupName: "Minnesota Purchasing Group",
};

const group = createBidNetGroup(MN_BIDNET_CONFIG);

if (group.listUrl !== MN_BIDNET_LIST_URL)
  throw new Error("mn_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MN_BIDNET_AGENCY)
  throw new Error("mn_bidnet: agency label does not match BidNet's group name");

export type MnBidnetRow = BidNetRow;
export type MnBidnetParseResult = BidNetParseResult;

export const mnBidnetListShapeOk = group.listShapeOk;
export const mnBidnetStatedOpenCount = group.statedOpenCount;
export const parseMnBidnetPageLinks = group.parsePageLinks;
export const parseMnBidnetRows = group.parseRows;

/** PURE parse of the Minnesota list rows — no network, no DB; `now` is injected. */
export const parseMnBidnet = group.parse;

/** Read BidNet's public Minnesota open-bids list, following its own pagination. */
export const fetchMnBidnetBids = group.fetchBids;
