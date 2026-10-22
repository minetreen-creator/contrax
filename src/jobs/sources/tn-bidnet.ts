/**
 * BidNet Direct — "Tennessee Purchasing Group" — `tn_bidnet`, the general-procurement bid surface
 * BidNet runs for Tennessee, alongside (never instead of) any Tennessee state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/tennessee/solicitations/open-bids
 * Its heading read `212 Open Solicitations` over 9 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Tennessee's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Tennessee`) is its
 * `location` (class STATE scoped to TN); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = tnbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Tennessee board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const TN_BIDNET_SOURCE = "tn_bidnet";
export const TN_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const TN_BIDNET_ID_PREFIX = "tnbidnet";
/** The engine default; 9 page(s) held the whole group on 2026-10-22. */
export const TN_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const TN_BIDNET_AGENCY = "Tennessee Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Tennessee Purchasing Group. */
export const TN_BIDNET_LIST_URL = `${TN_BIDNET_ORIGIN}/tennessee/solicitations/open-bids`;

const TN_BIDNET_CONFIG: BidNetGroupConfig = {
  source: TN_BIDNET_SOURCE,
  idPrefix: TN_BIDNET_ID_PREFIX,
  slug: "tennessee",
  stateName: "Tennessee",
  groupName: "Tennessee Purchasing Group",
};

const group = createBidNetGroup(TN_BIDNET_CONFIG);

if (group.listUrl !== TN_BIDNET_LIST_URL)
  throw new Error("tn_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== TN_BIDNET_AGENCY)
  throw new Error("tn_bidnet: agency label does not match BidNet's group name");

export type TnBidnetRow = BidNetRow;
export type TnBidnetParseResult = BidNetParseResult;

export const tnBidnetListShapeOk = group.listShapeOk;
export const tnBidnetStatedOpenCount = group.statedOpenCount;
export const parseTnBidnetPageLinks = group.parsePageLinks;
export const parseTnBidnetRows = group.parseRows;

/** PURE parse of the Tennessee list rows — no network, no DB; `now` is injected. */
export const parseTnBidnet = group.parse;

/** Read BidNet's public Tennessee open-bids list, following its own pagination. */
export const fetchTnBidnetBids = group.fetchBids;
