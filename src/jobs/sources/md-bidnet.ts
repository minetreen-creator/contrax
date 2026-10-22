/**
 * BidNet Direct — "Maryland Purchasing Group" — `md_bidnet`, the general-procurement bid surface
 * BidNet runs for Maryland, alongside (never instead of) any Maryland state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/maryland/solicitations/open-bids
 * Its heading read `451 Open Solicitations` over 19 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Maryland's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Maryland`) is its
 * `location` (class STATE scoped to MD); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mdbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Maryland board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MD_BIDNET_SOURCE = "md_bidnet";
export const MD_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MD_BIDNET_ID_PREFIX = "mdbidnet";
/** The engine default; 19 page(s) held the whole group on 2026-10-22. */
export const MD_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MD_BIDNET_AGENCY = "Maryland Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Maryland Purchasing Group. */
export const MD_BIDNET_LIST_URL = `${MD_BIDNET_ORIGIN}/maryland/solicitations/open-bids`;

const MD_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MD_BIDNET_SOURCE,
  idPrefix: MD_BIDNET_ID_PREFIX,
  slug: "maryland",
  stateName: "Maryland",
  groupName: "Maryland Purchasing Group",
};

const group = createBidNetGroup(MD_BIDNET_CONFIG);

if (group.listUrl !== MD_BIDNET_LIST_URL)
  throw new Error("md_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MD_BIDNET_AGENCY)
  throw new Error("md_bidnet: agency label does not match BidNet's group name");

export type MdBidnetRow = BidNetRow;
export type MdBidnetParseResult = BidNetParseResult;

export const mdBidnetListShapeOk = group.listShapeOk;
export const mdBidnetStatedOpenCount = group.statedOpenCount;
export const parseMdBidnetPageLinks = group.parsePageLinks;
export const parseMdBidnetRows = group.parseRows;

/** PURE parse of the Maryland list rows — no network, no DB; `now` is injected. */
export const parseMdBidnet = group.parse;

/** Read BidNet's public Maryland open-bids list, following its own pagination. */
export const fetchMdBidnetBids = group.fetchBids;
