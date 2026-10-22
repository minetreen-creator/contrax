/**
 * BidNet Direct — "Rhode Island Purchasing Group" — `ri_bidnet`, the general-procurement bid surface
 * BidNet runs for Rhode Island, alongside (never instead of) any Rhode Island state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/rhode-island/solicitations/open-bids
 * Its heading read `48 Open Solicitations` over 2 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Rhode Island's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Rhode Island`) is its
 * `location` (class STATE scoped to RI); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ribidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Rhode Island board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const RI_BIDNET_SOURCE = "ri_bidnet";
export const RI_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const RI_BIDNET_ID_PREFIX = "ribidnet";
/** The engine default; 2 page(s) held the whole group on 2026-10-22. */
export const RI_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const RI_BIDNET_AGENCY = "Rhode Island Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Rhode Island Purchasing Group. */
export const RI_BIDNET_LIST_URL = `${RI_BIDNET_ORIGIN}/rhode-island/solicitations/open-bids`;

const RI_BIDNET_CONFIG: BidNetGroupConfig = {
  source: RI_BIDNET_SOURCE,
  idPrefix: RI_BIDNET_ID_PREFIX,
  slug: "rhode-island",
  stateName: "Rhode Island",
  groupName: "Rhode Island Purchasing Group",
};

const group = createBidNetGroup(RI_BIDNET_CONFIG);

if (group.listUrl !== RI_BIDNET_LIST_URL)
  throw new Error("ri_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== RI_BIDNET_AGENCY)
  throw new Error("ri_bidnet: agency label does not match BidNet's group name");

export type RiBidnetRow = BidNetRow;
export type RiBidnetParseResult = BidNetParseResult;

export const riBidnetListShapeOk = group.listShapeOk;
export const riBidnetStatedOpenCount = group.statedOpenCount;
export const parseRiBidnetPageLinks = group.parsePageLinks;
export const parseRiBidnetRows = group.parseRows;

/** PURE parse of the Rhode Island list rows — no network, no DB; `now` is injected. */
export const parseRiBidnet = group.parse;

/** Read BidNet's public Rhode Island open-bids list, following its own pagination. */
export const fetchRiBidnetBids = group.fetchBids;
