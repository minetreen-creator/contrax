/**
 * BidNet Direct — "Idaho Purchasing Group" — `id_bidnet`, the general-procurement bid surface
 * BidNet runs for Idaho, alongside (never instead of) any Idaho state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/idaho/solicitations/open-bids
 * Its heading read `88 Open Solicitations` over 4 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Idaho's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Idaho`) is its
 * `location` (class STATE scoped to ID); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = idbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Idaho board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const ID_BIDNET_SOURCE = "id_bidnet";
export const ID_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const ID_BIDNET_ID_PREFIX = "idbidnet";
/** The engine default; 4 page(s) held the whole group on 2026-10-22. */
export const ID_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const ID_BIDNET_AGENCY = "Idaho Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Idaho Purchasing Group. */
export const ID_BIDNET_LIST_URL = `${ID_BIDNET_ORIGIN}/idaho/solicitations/open-bids`;

const ID_BIDNET_CONFIG: BidNetGroupConfig = {
  source: ID_BIDNET_SOURCE,
  idPrefix: ID_BIDNET_ID_PREFIX,
  slug: "idaho",
  stateName: "Idaho",
  groupName: "Idaho Purchasing Group",
};

const group = createBidNetGroup(ID_BIDNET_CONFIG);

if (group.listUrl !== ID_BIDNET_LIST_URL)
  throw new Error("id_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== ID_BIDNET_AGENCY)
  throw new Error("id_bidnet: agency label does not match BidNet's group name");

export type IdBidnetRow = BidNetRow;
export type IdBidnetParseResult = BidNetParseResult;

export const idBidnetListShapeOk = group.listShapeOk;
export const idBidnetStatedOpenCount = group.statedOpenCount;
export const parseIdBidnetPageLinks = group.parsePageLinks;
export const parseIdBidnetRows = group.parseRows;

/** PURE parse of the Idaho list rows — no network, no DB; `now` is injected. */
export const parseIdBidnet = group.parse;

/** Read BidNet's public Idaho open-bids list, following its own pagination. */
export const fetchIdBidnetBids = group.fetchBids;
