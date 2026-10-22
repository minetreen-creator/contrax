/**
 * BidNet Direct — "Colorado Purchasing Group" — `co_bidnet`, the general-procurement bid surface
 * BidNet runs for Colorado, alongside (never instead of) any Colorado state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/colorado/solicitations/open-bids
 * Its heading read `397 Open Solicitations` over 16 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Colorado's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (Colorado, Wyoming on 2026-10-22) is its
 * `location` (class STATE scoped to CO); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = cobidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Colorado board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const CO_BIDNET_SOURCE = "co_bidnet";
export const CO_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const CO_BIDNET_ID_PREFIX = "cobidnet";
/** The engine default; 16 page(s) held the whole group on 2026-10-22. */
export const CO_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const CO_BIDNET_AGENCY = "Colorado Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Colorado Purchasing Group. */
export const CO_BIDNET_LIST_URL = `${CO_BIDNET_ORIGIN}/colorado/solicitations/open-bids`;

const CO_BIDNET_CONFIG: BidNetGroupConfig = {
  source: CO_BIDNET_SOURCE,
  idPrefix: CO_BIDNET_ID_PREFIX,
  slug: "colorado",
  stateName: "Colorado",
  groupName: "Colorado Purchasing Group",
};

const group = createBidNetGroup(CO_BIDNET_CONFIG);

if (group.listUrl !== CO_BIDNET_LIST_URL)
  throw new Error("co_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== CO_BIDNET_AGENCY)
  throw new Error("co_bidnet: agency label does not match BidNet's group name");

export type CoBidnetRow = BidNetRow;
export type CoBidnetParseResult = BidNetParseResult;

export const coBidnetListShapeOk = group.listShapeOk;
export const coBidnetStatedOpenCount = group.statedOpenCount;
export const parseCoBidnetPageLinks = group.parsePageLinks;
export const parseCoBidnetRows = group.parseRows;

/** PURE parse of the Colorado list rows — no network, no DB; `now` is injected. */
export const parseCoBidnet = group.parse;

/** Read BidNet's public Colorado open-bids list, following its own pagination. */
export const fetchCoBidnetBids = group.fetchBids;
