/**
 * BidNet Direct — "Arkansas Purchasing Group" — `ar_bidnet`, the general-procurement bid surface
 * BidNet runs for Arkansas, alongside (never instead of) any Arkansas state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/arkansas/solicitations/open-bids
 * Its heading read `180 Open Solicitations` over 8 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Arkansas's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Arkansas`) is its
 * `location` (class STATE scoped to AR); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = arbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Arkansas board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const AR_BIDNET_SOURCE = "ar_bidnet";
export const AR_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const AR_BIDNET_ID_PREFIX = "arbidnet";
/** The engine default; 8 page(s) held the whole group on 2026-10-22. */
export const AR_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const AR_BIDNET_AGENCY = "Arkansas Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Arkansas Purchasing Group. */
export const AR_BIDNET_LIST_URL = `${AR_BIDNET_ORIGIN}/arkansas/solicitations/open-bids`;

const AR_BIDNET_CONFIG: BidNetGroupConfig = {
  source: AR_BIDNET_SOURCE,
  idPrefix: AR_BIDNET_ID_PREFIX,
  slug: "arkansas",
  stateName: "Arkansas",
  groupName: "Arkansas Purchasing Group",
};

const group = createBidNetGroup(AR_BIDNET_CONFIG);

if (group.listUrl !== AR_BIDNET_LIST_URL)
  throw new Error("ar_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== AR_BIDNET_AGENCY)
  throw new Error("ar_bidnet: agency label does not match BidNet's group name");

export type ArBidnetRow = BidNetRow;
export type ArBidnetParseResult = BidNetParseResult;

export const arBidnetListShapeOk = group.listShapeOk;
export const arBidnetStatedOpenCount = group.statedOpenCount;
export const parseArBidnetPageLinks = group.parsePageLinks;
export const parseArBidnetRows = group.parseRows;

/** PURE parse of the Arkansas list rows — no network, no DB; `now` is injected. */
export const parseArBidnet = group.parse;

/** Read BidNet's public Arkansas open-bids list, following its own pagination. */
export const fetchArBidnetBids = group.fetchBids;
