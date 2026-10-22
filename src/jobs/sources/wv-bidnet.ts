/**
 * BidNet Direct — "West Virginia Purchasing Group" — `wv_bidnet`, the general-procurement bid surface
 * BidNet runs for West Virginia, alongside (never instead of) any West Virginia state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/west-virginia/solicitations/open-bids
 * Its heading read `104 Open Solicitations` over 5 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of West Virginia's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`West Virginia`) is its
 * `location` (class STATE scoped to WV); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = wvbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other West Virginia board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const WV_BIDNET_SOURCE = "wv_bidnet";
export const WV_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const WV_BIDNET_ID_PREFIX = "wvbidnet";
/** The engine default; 5 page(s) held the whole group on 2026-10-22. */
export const WV_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const WV_BIDNET_AGENCY = "West Virginia Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's West Virginia Purchasing Group. */
export const WV_BIDNET_LIST_URL = `${WV_BIDNET_ORIGIN}/west-virginia/solicitations/open-bids`;

const WV_BIDNET_CONFIG: BidNetGroupConfig = {
  source: WV_BIDNET_SOURCE,
  idPrefix: WV_BIDNET_ID_PREFIX,
  slug: "west-virginia",
  stateName: "West Virginia",
  groupName: "West Virginia Purchasing Group",
};

const group = createBidNetGroup(WV_BIDNET_CONFIG);

if (group.listUrl !== WV_BIDNET_LIST_URL)
  throw new Error("wv_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== WV_BIDNET_AGENCY)
  throw new Error("wv_bidnet: agency label does not match BidNet's group name");

export type WvBidnetRow = BidNetRow;
export type WvBidnetParseResult = BidNetParseResult;

export const wvBidnetListShapeOk = group.listShapeOk;
export const wvBidnetStatedOpenCount = group.statedOpenCount;
export const parseWvBidnetPageLinks = group.parsePageLinks;
export const parseWvBidnetRows = group.parseRows;

/** PURE parse of the West Virginia list rows — no network, no DB; `now` is injected. */
export const parseWvBidnet = group.parse;

/** Read BidNet's public West Virginia open-bids list, following its own pagination. */
export const fetchWvBidnetBids = group.fetchBids;
