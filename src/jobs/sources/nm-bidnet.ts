/**
 * BidNet Direct — "New Mexico Purchasing Group" — `nm_bidnet`, the general-procurement bid surface
 * BidNet runs for New Mexico, alongside (never instead of) any New Mexico state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/new-mexico/solicitations/open-bids
 * Its heading read `17 Open Solicitations` over 1 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of New Mexico's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`New Mexico`) is its
 * `location` (class STATE scoped to NM); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = nmbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other New Mexico board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NM_BIDNET_SOURCE = "nm_bidnet";
export const NM_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NM_BIDNET_ID_PREFIX = "nmbidnet";
/** The engine default; 1 page(s) held the whole group on 2026-10-22. */
export const NM_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NM_BIDNET_AGENCY = "New Mexico Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's New Mexico Purchasing Group. */
export const NM_BIDNET_LIST_URL = `${NM_BIDNET_ORIGIN}/new-mexico/solicitations/open-bids`;

const NM_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NM_BIDNET_SOURCE,
  idPrefix: NM_BIDNET_ID_PREFIX,
  slug: "new-mexico",
  stateName: "New Mexico",
  groupName: "New Mexico Purchasing Group",
};

const group = createBidNetGroup(NM_BIDNET_CONFIG);

if (group.listUrl !== NM_BIDNET_LIST_URL)
  throw new Error("nm_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NM_BIDNET_AGENCY)
  throw new Error("nm_bidnet: agency label does not match BidNet's group name");

export type NmBidnetRow = BidNetRow;
export type NmBidnetParseResult = BidNetParseResult;

export const nmBidnetListShapeOk = group.listShapeOk;
export const nmBidnetStatedOpenCount = group.statedOpenCount;
export const parseNmBidnetPageLinks = group.parsePageLinks;
export const parseNmBidnetRows = group.parseRows;

/** PURE parse of the New Mexico list rows — no network, no DB; `now` is injected. */
export const parseNmBidnet = group.parse;

/** Read BidNet's public New Mexico open-bids list, following its own pagination. */
export const fetchNmBidnetBids = group.fetchBids;
