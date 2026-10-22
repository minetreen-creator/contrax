/**
 * BidNet Direct — "Montana Purchasing Group" — `mt_bidnet`, the general-procurement bid surface
 * BidNet runs for Montana, alongside (never instead of) any Montana state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/montana/solicitations/open-bids
 * Its heading read `97 Open Solicitations` over 4 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Montana's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Montana`) is its
 * `location` (class STATE scoped to MT); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mtbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Montana board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MT_BIDNET_SOURCE = "mt_bidnet";
export const MT_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MT_BIDNET_ID_PREFIX = "mtbidnet";
/** The engine default; 4 page(s) held the whole group on 2026-10-22. */
export const MT_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MT_BIDNET_AGENCY = "Montana Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Montana Purchasing Group. */
export const MT_BIDNET_LIST_URL = `${MT_BIDNET_ORIGIN}/montana/solicitations/open-bids`;

const MT_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MT_BIDNET_SOURCE,
  idPrefix: MT_BIDNET_ID_PREFIX,
  slug: "montana",
  stateName: "Montana",
  groupName: "Montana Purchasing Group",
};

const group = createBidNetGroup(MT_BIDNET_CONFIG);

if (group.listUrl !== MT_BIDNET_LIST_URL)
  throw new Error("mt_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MT_BIDNET_AGENCY)
  throw new Error("mt_bidnet: agency label does not match BidNet's group name");

export type MtBidnetRow = BidNetRow;
export type MtBidnetParseResult = BidNetParseResult;

export const mtBidnetListShapeOk = group.listShapeOk;
export const mtBidnetStatedOpenCount = group.statedOpenCount;
export const parseMtBidnetPageLinks = group.parsePageLinks;
export const parseMtBidnetRows = group.parseRows;

/** PURE parse of the Montana list rows — no network, no DB; `now` is injected. */
export const parseMtBidnet = group.parse;

/** Read BidNet's public Montana open-bids list, following its own pagination. */
export const fetchMtBidnetBids = group.fetchBids;
