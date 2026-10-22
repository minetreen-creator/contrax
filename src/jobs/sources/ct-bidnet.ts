/**
 * BidNet Direct — "Connecticut Purchasing Group" — `ct_bidnet`, the general-procurement bid surface
 * BidNet runs for Connecticut, alongside (never instead of) any Connecticut state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/connecticut/solicitations/open-bids
 * Its heading read `212 Open Solicitations` over 9 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Connecticut's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Connecticut`) is its
 * `location` (class STATE scoped to CT); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ctbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Connecticut board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const CT_BIDNET_SOURCE = "ct_bidnet";
export const CT_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const CT_BIDNET_ID_PREFIX = "ctbidnet";
/** The engine default; 9 page(s) held the whole group on 2026-10-22. */
export const CT_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const CT_BIDNET_AGENCY = "Connecticut Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Connecticut Purchasing Group. */
export const CT_BIDNET_LIST_URL = `${CT_BIDNET_ORIGIN}/connecticut/solicitations/open-bids`;

const CT_BIDNET_CONFIG: BidNetGroupConfig = {
  source: CT_BIDNET_SOURCE,
  idPrefix: CT_BIDNET_ID_PREFIX,
  slug: "connecticut",
  stateName: "Connecticut",
  groupName: "Connecticut Purchasing Group",
};

const group = createBidNetGroup(CT_BIDNET_CONFIG);

if (group.listUrl !== CT_BIDNET_LIST_URL)
  throw new Error("ct_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== CT_BIDNET_AGENCY)
  throw new Error("ct_bidnet: agency label does not match BidNet's group name");

export type CtBidnetRow = BidNetRow;
export type CtBidnetParseResult = BidNetParseResult;

export const ctBidnetListShapeOk = group.listShapeOk;
export const ctBidnetStatedOpenCount = group.statedOpenCount;
export const parseCtBidnetPageLinks = group.parsePageLinks;
export const parseCtBidnetRows = group.parseRows;

/** PURE parse of the Connecticut list rows — no network, no DB; `now` is injected. */
export const parseCtBidnet = group.parse;

/** Read BidNet's public Connecticut open-bids list, following its own pagination. */
export const fetchCtBidnetBids = group.fetchBids;
