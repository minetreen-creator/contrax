/**
 * BidNet Direct — "Wisconsin Purchasing Group" — `wi_bidnet`, the general-procurement bid surface
 * BidNet runs for Wisconsin, alongside (never instead of) any Wisconsin state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/wisconsin/solicitations/open-bids
 * Its heading read `250 Open Solicitations` over 10 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Wisconsin's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Wisconsin`) is its
 * `location` (class STATE scoped to WI); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = wibidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Wisconsin board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const WI_BIDNET_SOURCE = "wi_bidnet";
export const WI_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const WI_BIDNET_ID_PREFIX = "wibidnet";
/** The engine default; 10 page(s) held the whole group on 2026-10-22. */
export const WI_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const WI_BIDNET_AGENCY = "Wisconsin Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Wisconsin Purchasing Group. */
export const WI_BIDNET_LIST_URL = `${WI_BIDNET_ORIGIN}/wisconsin/solicitations/open-bids`;

const WI_BIDNET_CONFIG: BidNetGroupConfig = {
  source: WI_BIDNET_SOURCE,
  idPrefix: WI_BIDNET_ID_PREFIX,
  slug: "wisconsin",
  stateName: "Wisconsin",
  groupName: "Wisconsin Purchasing Group",
};

const group = createBidNetGroup(WI_BIDNET_CONFIG);

if (group.listUrl !== WI_BIDNET_LIST_URL)
  throw new Error("wi_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== WI_BIDNET_AGENCY)
  throw new Error("wi_bidnet: agency label does not match BidNet's group name");

export type WiBidnetRow = BidNetRow;
export type WiBidnetParseResult = BidNetParseResult;

export const wiBidnetListShapeOk = group.listShapeOk;
export const wiBidnetStatedOpenCount = group.statedOpenCount;
export const parseWiBidnetPageLinks = group.parsePageLinks;
export const parseWiBidnetRows = group.parseRows;

/** PURE parse of the Wisconsin list rows — no network, no DB; `now` is injected. */
export const parseWiBidnet = group.parse;

/** Read BidNet's public Wisconsin open-bids list, following its own pagination. */
export const fetchWiBidnetBids = group.fetchBids;
