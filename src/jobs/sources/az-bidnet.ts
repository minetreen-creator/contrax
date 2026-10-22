/**
 * BidNet Direct — "Arizona Purchasing Group" — `az_bidnet`, the general-procurement bid surface
 * BidNet runs for Arizona, alongside (never instead of) any Arizona state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/arizona/solicitations/open-bids
 * Its heading read `251 Open Solicitations` over 11 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Arizona's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Arizona`) is its
 * `location` (class STATE scoped to AZ); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = azbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Arizona board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const AZ_BIDNET_SOURCE = "az_bidnet";
export const AZ_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const AZ_BIDNET_ID_PREFIX = "azbidnet";
/** The engine default; 11 page(s) held the whole group on 2026-10-22. */
export const AZ_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const AZ_BIDNET_AGENCY = "Arizona Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Arizona Purchasing Group. */
export const AZ_BIDNET_LIST_URL = `${AZ_BIDNET_ORIGIN}/arizona/solicitations/open-bids`;

const AZ_BIDNET_CONFIG: BidNetGroupConfig = {
  source: AZ_BIDNET_SOURCE,
  idPrefix: AZ_BIDNET_ID_PREFIX,
  slug: "arizona",
  stateName: "Arizona",
  groupName: "Arizona Purchasing Group",
};

const group = createBidNetGroup(AZ_BIDNET_CONFIG);

if (group.listUrl !== AZ_BIDNET_LIST_URL)
  throw new Error("az_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== AZ_BIDNET_AGENCY)
  throw new Error("az_bidnet: agency label does not match BidNet's group name");

export type AzBidnetRow = BidNetRow;
export type AzBidnetParseResult = BidNetParseResult;

export const azBidnetListShapeOk = group.listShapeOk;
export const azBidnetStatedOpenCount = group.statedOpenCount;
export const parseAzBidnetPageLinks = group.parsePageLinks;
export const parseAzBidnetRows = group.parseRows;

/** PURE parse of the Arizona list rows — no network, no DB; `now` is injected. */
export const parseAzBidnet = group.parse;

/** Read BidNet's public Arizona open-bids list, following its own pagination. */
export const fetchAzBidnetBids = group.fetchBids;
