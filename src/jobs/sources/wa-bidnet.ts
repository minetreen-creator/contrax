/**
 * BidNet Direct — "Washington Purchasing Group" — `wa_bidnet`, the general-procurement bid surface
 * BidNet runs for Washington, alongside (never instead of) any Washington state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/washington/solicitations/open-bids
 * Its heading read `594 Open Solicitations` over 24 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Washington's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Washington`) is its
 * `location` (class STATE scoped to WA); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = wabidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Washington board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const WA_BIDNET_SOURCE = "wa_bidnet";
export const WA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const WA_BIDNET_ID_PREFIX = "wabidnet";
/** The engine default; 24 page(s) held the whole group on 2026-10-22. */
export const WA_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const WA_BIDNET_AGENCY = "Washington Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Washington Purchasing Group. */
export const WA_BIDNET_LIST_URL = `${WA_BIDNET_ORIGIN}/washington/solicitations/open-bids`;

const WA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: WA_BIDNET_SOURCE,
  idPrefix: WA_BIDNET_ID_PREFIX,
  slug: "washington",
  stateName: "Washington",
  groupName: "Washington Purchasing Group",
};

const group = createBidNetGroup(WA_BIDNET_CONFIG);

if (group.listUrl !== WA_BIDNET_LIST_URL)
  throw new Error("wa_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== WA_BIDNET_AGENCY)
  throw new Error("wa_bidnet: agency label does not match BidNet's group name");

export type WaBidnetRow = BidNetRow;
export type WaBidnetParseResult = BidNetParseResult;

export const waBidnetListShapeOk = group.listShapeOk;
export const waBidnetStatedOpenCount = group.statedOpenCount;
export const parseWaBidnetPageLinks = group.parsePageLinks;
export const parseWaBidnetRows = group.parseRows;

/** PURE parse of the Washington list rows — no network, no DB; `now` is injected. */
export const parseWaBidnet = group.parse;

/** Read BidNet's public Washington open-bids list, following its own pagination. */
export const fetchWaBidnetBids = group.fetchBids;
