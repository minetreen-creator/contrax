/**
 * BidNet Direct — "Iowa Purchasing Group" — `ia_bidnet`, the general-procurement bid surface
 * BidNet runs for Iowa, alongside (never instead of) any Iowa state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/iowa/solicitations/open-bids
 * Its heading read `236 Open Solicitations` over 10 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Iowa's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Iowa`) is its
 * `location` (class STATE scoped to IA); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = iabidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Iowa board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const IA_BIDNET_SOURCE = "ia_bidnet";
export const IA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const IA_BIDNET_ID_PREFIX = "iabidnet";
/** The engine default; 10 page(s) held the whole group on 2026-10-22. */
export const IA_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const IA_BIDNET_AGENCY = "Iowa Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Iowa Purchasing Group. */
export const IA_BIDNET_LIST_URL = `${IA_BIDNET_ORIGIN}/iowa/solicitations/open-bids`;

const IA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: IA_BIDNET_SOURCE,
  idPrefix: IA_BIDNET_ID_PREFIX,
  slug: "iowa",
  stateName: "Iowa",
  groupName: "Iowa Purchasing Group",
};

const group = createBidNetGroup(IA_BIDNET_CONFIG);

if (group.listUrl !== IA_BIDNET_LIST_URL)
  throw new Error("ia_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== IA_BIDNET_AGENCY)
  throw new Error("ia_bidnet: agency label does not match BidNet's group name");

export type IaBidnetRow = BidNetRow;
export type IaBidnetParseResult = BidNetParseResult;

export const iaBidnetListShapeOk = group.listShapeOk;
export const iaBidnetStatedOpenCount = group.statedOpenCount;
export const parseIaBidnetPageLinks = group.parsePageLinks;
export const parseIaBidnetRows = group.parseRows;

/** PURE parse of the Iowa list rows — no network, no DB; `now` is injected. */
export const parseIaBidnet = group.parse;

/** Read BidNet's public Iowa open-bids list, following its own pagination. */
export const fetchIaBidnetBids = group.fetchBids;
