/**
 * BidNet Direct — "Louisiana Purchasing Group" — `la_bidnet`, the general-procurement bid surface
 * BidNet runs for Louisiana, alongside (never instead of) any Louisiana state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/louisiana/solicitations/open-bids
 * Its heading read `303 Open Solicitations` over 13 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Louisiana's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Louisiana`) is its
 * `location` (class STATE scoped to LA); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = labidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Louisiana board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const LA_BIDNET_SOURCE = "la_bidnet";
export const LA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const LA_BIDNET_ID_PREFIX = "labidnet";
/** The engine default; 13 page(s) held the whole group on 2026-10-22. */
export const LA_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const LA_BIDNET_AGENCY = "Louisiana Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Louisiana Purchasing Group. */
export const LA_BIDNET_LIST_URL = `${LA_BIDNET_ORIGIN}/louisiana/solicitations/open-bids`;

const LA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: LA_BIDNET_SOURCE,
  idPrefix: LA_BIDNET_ID_PREFIX,
  slug: "louisiana",
  stateName: "Louisiana",
  groupName: "Louisiana Purchasing Group",
};

const group = createBidNetGroup(LA_BIDNET_CONFIG);

if (group.listUrl !== LA_BIDNET_LIST_URL)
  throw new Error("la_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== LA_BIDNET_AGENCY)
  throw new Error("la_bidnet: agency label does not match BidNet's group name");

export type LaBidnetRow = BidNetRow;
export type LaBidnetParseResult = BidNetParseResult;

export const laBidnetListShapeOk = group.listShapeOk;
export const laBidnetStatedOpenCount = group.statedOpenCount;
export const parseLaBidnetPageLinks = group.parsePageLinks;
export const parseLaBidnetRows = group.parseRows;

/** PURE parse of the Louisiana list rows — no network, no DB; `now` is injected. */
export const parseLaBidnet = group.parse;

/** Read BidNet's public Louisiana open-bids list, following its own pagination. */
export const fetchLaBidnetBids = group.fetchBids;
