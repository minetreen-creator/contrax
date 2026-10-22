/**
 * BidNet Direct — "New Jersey Purchasing Group" — `nj_bidnet`, the general-procurement bid surface
 * BidNet runs for New Jersey, alongside (never instead of) any New Jersey state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/new-jersey/solicitations/open-bids
 * Its heading read `70 Open Solicitations` over 3 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of New Jersey's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`New Jersey`) is its
 * `location` (class STATE scoped to NJ); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = njbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other New Jersey board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NJ_BIDNET_SOURCE = "nj_bidnet";
export const NJ_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NJ_BIDNET_ID_PREFIX = "njbidnet";
/** The engine default; 3 page(s) held the whole group on 2026-10-22. */
export const NJ_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NJ_BIDNET_AGENCY = "New Jersey Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's New Jersey Purchasing Group. */
export const NJ_BIDNET_LIST_URL = `${NJ_BIDNET_ORIGIN}/new-jersey/solicitations/open-bids`;

const NJ_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NJ_BIDNET_SOURCE,
  idPrefix: NJ_BIDNET_ID_PREFIX,
  slug: "new-jersey",
  stateName: "New Jersey",
  groupName: "New Jersey Purchasing Group",
};

const group = createBidNetGroup(NJ_BIDNET_CONFIG);

if (group.listUrl !== NJ_BIDNET_LIST_URL)
  throw new Error("nj_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NJ_BIDNET_AGENCY)
  throw new Error("nj_bidnet: agency label does not match BidNet's group name");

export type NjBidnetRow = BidNetRow;
export type NjBidnetParseResult = BidNetParseResult;

export const njBidnetListShapeOk = group.listShapeOk;
export const njBidnetStatedOpenCount = group.statedOpenCount;
export const parseNjBidnetPageLinks = group.parsePageLinks;
export const parseNjBidnetRows = group.parseRows;

/** PURE parse of the New Jersey list rows — no network, no DB; `now` is injected. */
export const parseNjBidnet = group.parse;

/** Read BidNet's public New Jersey open-bids list, following its own pagination. */
export const fetchNjBidnetBids = group.fetchBids;
