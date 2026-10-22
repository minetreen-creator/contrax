/**
 * BidNet Direct — "North Dakota Purchasing Group" — `nd_bidnet`, the general-procurement bid surface
 * BidNet runs for North Dakota, alongside (never instead of) any North Dakota state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/north-dakota/solicitations/open-bids
 * Its heading read `61 Open Solicitations` over 3 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of North Dakota's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`North Dakota`) is its
 * `location` (class STATE scoped to ND); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ndbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other North Dakota board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const ND_BIDNET_SOURCE = "nd_bidnet";
export const ND_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const ND_BIDNET_ID_PREFIX = "ndbidnet";
/** The engine default; 3 page(s) held the whole group on 2026-10-22. */
export const ND_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const ND_BIDNET_AGENCY = "North Dakota Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's North Dakota Purchasing Group. */
export const ND_BIDNET_LIST_URL = `${ND_BIDNET_ORIGIN}/north-dakota/solicitations/open-bids`;

const ND_BIDNET_CONFIG: BidNetGroupConfig = {
  source: ND_BIDNET_SOURCE,
  idPrefix: ND_BIDNET_ID_PREFIX,
  slug: "north-dakota",
  stateName: "North Dakota",
  groupName: "North Dakota Purchasing Group",
};

const group = createBidNetGroup(ND_BIDNET_CONFIG);

if (group.listUrl !== ND_BIDNET_LIST_URL)
  throw new Error("nd_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== ND_BIDNET_AGENCY)
  throw new Error("nd_bidnet: agency label does not match BidNet's group name");

export type NdBidnetRow = BidNetRow;
export type NdBidnetParseResult = BidNetParseResult;

export const ndBidnetListShapeOk = group.listShapeOk;
export const ndBidnetStatedOpenCount = group.statedOpenCount;
export const parseNdBidnetPageLinks = group.parsePageLinks;
export const parseNdBidnetRows = group.parseRows;

/** PURE parse of the North Dakota list rows — no network, no DB; `now` is injected. */
export const parseNdBidnet = group.parse;

/** Read BidNet's public North Dakota open-bids list, following its own pagination. */
export const fetchNdBidnetBids = group.fetchBids;
