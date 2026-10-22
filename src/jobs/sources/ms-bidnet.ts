/**
 * BidNet Direct — "Mississippi Purchasing Group" — `ms_bidnet`, the general-procurement bid surface
 * BidNet runs for Mississippi, alongside (never instead of) any Mississippi state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/mississippi/solicitations/open-bids
 * Its heading read `183 Open Solicitations` over 8 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Mississippi's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Mississippi`) is its
 * `location` (class STATE scoped to MS); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = msbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Mississippi board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MS_BIDNET_SOURCE = "ms_bidnet";
export const MS_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MS_BIDNET_ID_PREFIX = "msbidnet";
/** The engine default; 8 page(s) held the whole group on 2026-10-22. */
export const MS_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MS_BIDNET_AGENCY = "Mississippi Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Mississippi Purchasing Group. */
export const MS_BIDNET_LIST_URL = `${MS_BIDNET_ORIGIN}/mississippi/solicitations/open-bids`;

const MS_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MS_BIDNET_SOURCE,
  idPrefix: MS_BIDNET_ID_PREFIX,
  slug: "mississippi",
  stateName: "Mississippi",
  groupName: "Mississippi Purchasing Group",
};

const group = createBidNetGroup(MS_BIDNET_CONFIG);

if (group.listUrl !== MS_BIDNET_LIST_URL)
  throw new Error("ms_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MS_BIDNET_AGENCY)
  throw new Error("ms_bidnet: agency label does not match BidNet's group name");

export type MsBidnetRow = BidNetRow;
export type MsBidnetParseResult = BidNetParseResult;

export const msBidnetListShapeOk = group.listShapeOk;
export const msBidnetStatedOpenCount = group.statedOpenCount;
export const parseMsBidnetPageLinks = group.parsePageLinks;
export const parseMsBidnetRows = group.parseRows;

/** PURE parse of the Mississippi list rows — no network, no DB; `now` is injected. */
export const parseMsBidnet = group.parse;

/** Read BidNet's public Mississippi open-bids list, following its own pagination. */
export const fetchMsBidnetBids = group.fetchBids;
