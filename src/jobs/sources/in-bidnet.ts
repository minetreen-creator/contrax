/**
 * BidNet Direct — "Indiana Purchasing Group" — `in_bidnet`, the general-procurement bid surface
 * BidNet runs for Indiana, alongside (never instead of) any Indiana state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/indiana/solicitations/open-bids
 * Its heading read `212 Open Solicitations` over 9 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Indiana's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Indiana`) is its
 * `location` (class STATE scoped to IN); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = inbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Indiana board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const IN_BIDNET_SOURCE = "in_bidnet";
export const IN_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const IN_BIDNET_ID_PREFIX = "inbidnet";
/** The engine default; 9 page(s) held the whole group on 2026-10-22. */
export const IN_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const IN_BIDNET_AGENCY = "Indiana Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Indiana Purchasing Group. */
export const IN_BIDNET_LIST_URL = `${IN_BIDNET_ORIGIN}/indiana/solicitations/open-bids`;

const IN_BIDNET_CONFIG: BidNetGroupConfig = {
  source: IN_BIDNET_SOURCE,
  idPrefix: IN_BIDNET_ID_PREFIX,
  slug: "indiana",
  stateName: "Indiana",
  groupName: "Indiana Purchasing Group",
};

const group = createBidNetGroup(IN_BIDNET_CONFIG);

if (group.listUrl !== IN_BIDNET_LIST_URL)
  throw new Error("in_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== IN_BIDNET_AGENCY)
  throw new Error("in_bidnet: agency label does not match BidNet's group name");

export type InBidnetRow = BidNetRow;
export type InBidnetParseResult = BidNetParseResult;

export const inBidnetListShapeOk = group.listShapeOk;
export const inBidnetStatedOpenCount = group.statedOpenCount;
export const parseInBidnetPageLinks = group.parsePageLinks;
export const parseInBidnetRows = group.parseRows;

/** PURE parse of the Indiana list rows — no network, no DB; `now` is injected. */
export const parseInBidnet = group.parse;

/** Read BidNet's public Indiana open-bids list, following its own pagination. */
export const fetchInBidnetBids = group.fetchBids;
