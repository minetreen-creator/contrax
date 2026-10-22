/**
 * BidNet Direct — "Delaware Purchasing Group" — `de_bidnet`, the general-procurement bid surface
 * BidNet runs for Delaware, alongside (never instead of) any Delaware state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/delaware/solicitations/open-bids
 * Its heading read `73 Open Solicitations` over 3 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Delaware's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Delaware`) is its
 * `location` (class STATE scoped to DE); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = debidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Delaware board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const DE_BIDNET_SOURCE = "de_bidnet";
export const DE_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const DE_BIDNET_ID_PREFIX = "debidnet";
/** The engine default; 3 page(s) held the whole group on 2026-10-22. */
export const DE_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const DE_BIDNET_AGENCY = "Delaware Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Delaware Purchasing Group. */
export const DE_BIDNET_LIST_URL = `${DE_BIDNET_ORIGIN}/delaware/solicitations/open-bids`;

const DE_BIDNET_CONFIG: BidNetGroupConfig = {
  source: DE_BIDNET_SOURCE,
  idPrefix: DE_BIDNET_ID_PREFIX,
  slug: "delaware",
  stateName: "Delaware",
  groupName: "Delaware Purchasing Group",
};

const group = createBidNetGroup(DE_BIDNET_CONFIG);

if (group.listUrl !== DE_BIDNET_LIST_URL)
  throw new Error("de_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== DE_BIDNET_AGENCY)
  throw new Error("de_bidnet: agency label does not match BidNet's group name");

export type DeBidnetRow = BidNetRow;
export type DeBidnetParseResult = BidNetParseResult;

export const deBidnetListShapeOk = group.listShapeOk;
export const deBidnetStatedOpenCount = group.statedOpenCount;
export const parseDeBidnetPageLinks = group.parsePageLinks;
export const parseDeBidnetRows = group.parseRows;

/** PURE parse of the Delaware list rows — no network, no DB; `now` is injected. */
export const parseDeBidnet = group.parse;

/** Read BidNet's public Delaware open-bids list, following its own pagination. */
export const fetchDeBidnetBids = group.fetchBids;
