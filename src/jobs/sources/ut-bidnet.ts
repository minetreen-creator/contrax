/**
 * BidNet Direct — "Utah Purchasing Group" — `ut_bidnet`, the general-procurement bid surface
 * BidNet runs for Utah, alongside (never instead of) any Utah state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/utah/solicitations/open-bids
 * Its heading read `294 Open Solicitations` over 12 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Utah's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Utah`) is its
 * `location` (class STATE scoped to UT); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = utbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Utah board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const UT_BIDNET_SOURCE = "ut_bidnet";
export const UT_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const UT_BIDNET_ID_PREFIX = "utbidnet";
/** The engine default; 12 page(s) held the whole group on 2026-10-22. */
export const UT_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const UT_BIDNET_AGENCY = "Utah Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Utah Purchasing Group. */
export const UT_BIDNET_LIST_URL = `${UT_BIDNET_ORIGIN}/utah/solicitations/open-bids`;

const UT_BIDNET_CONFIG: BidNetGroupConfig = {
  source: UT_BIDNET_SOURCE,
  idPrefix: UT_BIDNET_ID_PREFIX,
  slug: "utah",
  stateName: "Utah",
  groupName: "Utah Purchasing Group",
};

const group = createBidNetGroup(UT_BIDNET_CONFIG);

if (group.listUrl !== UT_BIDNET_LIST_URL)
  throw new Error("ut_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== UT_BIDNET_AGENCY)
  throw new Error("ut_bidnet: agency label does not match BidNet's group name");

export type UtBidnetRow = BidNetRow;
export type UtBidnetParseResult = BidNetParseResult;

export const utBidnetListShapeOk = group.listShapeOk;
export const utBidnetStatedOpenCount = group.statedOpenCount;
export const parseUtBidnetPageLinks = group.parsePageLinks;
export const parseUtBidnetRows = group.parseRows;

/** PURE parse of the Utah list rows — no network, no DB; `now` is injected. */
export const parseUtBidnet = group.parse;

/** Read BidNet's public Utah open-bids list, following its own pagination. */
export const fetchUtBidnetBids = group.fetchBids;
