/**
 * BidNet Direct — "Vermont Purchasing Group" — `vt_bidnet`, the general-procurement bid surface
 * BidNet runs for Vermont, alongside (never instead of) any Vermont state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/vermont/solicitations/open-bids
 * Its heading read `61 Open Solicitations` over 3 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Vermont's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Vermont`) is its
 * `location` (class STATE scoped to VT); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = vtbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Vermont board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const VT_BIDNET_SOURCE = "vt_bidnet";
export const VT_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const VT_BIDNET_ID_PREFIX = "vtbidnet";
/** The engine default; 3 page(s) held the whole group on 2026-10-22. */
export const VT_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const VT_BIDNET_AGENCY = "Vermont Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Vermont Purchasing Group. */
export const VT_BIDNET_LIST_URL = `${VT_BIDNET_ORIGIN}/vermont/solicitations/open-bids`;

const VT_BIDNET_CONFIG: BidNetGroupConfig = {
  source: VT_BIDNET_SOURCE,
  idPrefix: VT_BIDNET_ID_PREFIX,
  slug: "vermont",
  stateName: "Vermont",
  groupName: "Vermont Purchasing Group",
};

const group = createBidNetGroup(VT_BIDNET_CONFIG);

if (group.listUrl !== VT_BIDNET_LIST_URL)
  throw new Error("vt_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== VT_BIDNET_AGENCY)
  throw new Error("vt_bidnet: agency label does not match BidNet's group name");

export type VtBidnetRow = BidNetRow;
export type VtBidnetParseResult = BidNetParseResult;

export const vtBidnetListShapeOk = group.listShapeOk;
export const vtBidnetStatedOpenCount = group.statedOpenCount;
export const parseVtBidnetPageLinks = group.parsePageLinks;
export const parseVtBidnetRows = group.parseRows;

/** PURE parse of the Vermont list rows — no network, no DB; `now` is injected. */
export const parseVtBidnet = group.parse;

/** Read BidNet's public Vermont open-bids list, following its own pagination. */
export const fetchVtBidnetBids = group.fetchBids;
