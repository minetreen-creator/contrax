/**
 * BidNet Direct — "Hawaii Purchasing Group" — `hi_bidnet`, the general-procurement bid surface
 * BidNet runs for Hawaii, alongside (never instead of) any Hawaii state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/hawaii/solicitations/open-bids
 * Its heading read `246 Open Solicitations` over 10 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Hawaii's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Hawaii`) is its
 * `location` (class STATE scoped to HI); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = hibidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Hawaii board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const HI_BIDNET_SOURCE = "hi_bidnet";
export const HI_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const HI_BIDNET_ID_PREFIX = "hibidnet";
/** The engine default; 10 page(s) held the whole group on 2026-10-22. */
export const HI_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const HI_BIDNET_AGENCY = "Hawaii Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Hawaii Purchasing Group. */
export const HI_BIDNET_LIST_URL = `${HI_BIDNET_ORIGIN}/hawaii/solicitations/open-bids`;

const HI_BIDNET_CONFIG: BidNetGroupConfig = {
  source: HI_BIDNET_SOURCE,
  idPrefix: HI_BIDNET_ID_PREFIX,
  slug: "hawaii",
  stateName: "Hawaii",
  groupName: "Hawaii Purchasing Group",
};

const group = createBidNetGroup(HI_BIDNET_CONFIG);

if (group.listUrl !== HI_BIDNET_LIST_URL)
  throw new Error("hi_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== HI_BIDNET_AGENCY)
  throw new Error("hi_bidnet: agency label does not match BidNet's group name");

export type HiBidnetRow = BidNetRow;
export type HiBidnetParseResult = BidNetParseResult;

export const hiBidnetListShapeOk = group.listShapeOk;
export const hiBidnetStatedOpenCount = group.statedOpenCount;
export const parseHiBidnetPageLinks = group.parsePageLinks;
export const parseHiBidnetRows = group.parseRows;

/** PURE parse of the Hawaii list rows — no network, no DB; `now` is injected. */
export const parseHiBidnet = group.parse;

/** Read BidNet's public Hawaii open-bids list, following its own pagination. */
export const fetchHiBidnetBids = group.fetchBids;
