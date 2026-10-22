/**
 * BidNet Direct — "Nebraska Purchasing Group" — `ne_bidnet`, the general-procurement bid surface
 * BidNet runs for Nebraska, alongside (never instead of) any Nebraska state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/nebraska/solicitations/open-bids
 * Its heading read `106 Open Solicitations` over 5 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Nebraska's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Nebraska`) is its
 * `location` (class STATE scoped to NE); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = nebidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Nebraska board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NE_BIDNET_SOURCE = "ne_bidnet";
export const NE_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NE_BIDNET_ID_PREFIX = "nebidnet";
/** The engine default; 5 page(s) held the whole group on 2026-10-22. */
export const NE_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NE_BIDNET_AGENCY = "Nebraska Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Nebraska Purchasing Group. */
export const NE_BIDNET_LIST_URL = `${NE_BIDNET_ORIGIN}/nebraska/solicitations/open-bids`;

const NE_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NE_BIDNET_SOURCE,
  idPrefix: NE_BIDNET_ID_PREFIX,
  slug: "nebraska",
  stateName: "Nebraska",
  groupName: "Nebraska Purchasing Group",
};

const group = createBidNetGroup(NE_BIDNET_CONFIG);

if (group.listUrl !== NE_BIDNET_LIST_URL)
  throw new Error("ne_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NE_BIDNET_AGENCY)
  throw new Error("ne_bidnet: agency label does not match BidNet's group name");

export type NeBidnetRow = BidNetRow;
export type NeBidnetParseResult = BidNetParseResult;

export const neBidnetListShapeOk = group.listShapeOk;
export const neBidnetStatedOpenCount = group.statedOpenCount;
export const parseNeBidnetPageLinks = group.parsePageLinks;
export const parseNeBidnetRows = group.parseRows;

/** PURE parse of the Nebraska list rows — no network, no DB; `now` is injected. */
export const parseNeBidnet = group.parse;

/** Read BidNet's public Nebraska open-bids list, following its own pagination. */
export const fetchNeBidnetBids = group.fetchBids;
