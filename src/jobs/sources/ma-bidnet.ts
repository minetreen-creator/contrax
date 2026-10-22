/**
 * BidNet Direct — "Massachusetts Purchasing Group" — `ma_bidnet`, the general-procurement bid surface
 * BidNet runs for Massachusetts, alongside (never instead of) any Massachusetts state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/massachusetts/solicitations/open-bids
 * Its heading read `910 Open Solicitations` over 37 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Massachusetts's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Massachusetts`) is its
 * `location` (class STATE scoped to MA); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mabidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Massachusetts board.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MA_BIDNET_SOURCE = "ma_bidnet";
export const MA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MA_BIDNET_ID_PREFIX = "mabidnet";
/** 37 pages on 2026-10-22, near the engine default (40), so this group sets its own. */
export const MA_BIDNET_MAX_PAGES = 150;
/** Per-pass abort for THIS group (engine default 120 s). */
export const MA_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MA_BIDNET_AGENCY = "Massachusetts Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Massachusetts Purchasing Group. */
export const MA_BIDNET_LIST_URL = `${MA_BIDNET_ORIGIN}/massachusetts/solicitations/open-bids`;

const MA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MA_BIDNET_SOURCE,
  idPrefix: MA_BIDNET_ID_PREFIX,
  slug: "massachusetts",
  stateName: "Massachusetts",
  groupName: "Massachusetts Purchasing Group",
  maxPages: MA_BIDNET_MAX_PAGES,
  passTimeoutMs: MA_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(MA_BIDNET_CONFIG);

if (group.listUrl !== MA_BIDNET_LIST_URL)
  throw new Error("ma_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MA_BIDNET_AGENCY)
  throw new Error("ma_bidnet: agency label does not match BidNet's group name");

export type MaBidnetRow = BidNetRow;
export type MaBidnetParseResult = BidNetParseResult;

export const maBidnetListShapeOk = group.listShapeOk;
export const maBidnetStatedOpenCount = group.statedOpenCount;
export const parseMaBidnetPageLinks = group.parsePageLinks;
export const parseMaBidnetRows = group.parseRows;

/** PURE parse of the Massachusetts list rows — no network, no DB; `now` is injected. */
export const parseMaBidnet = group.parse;

/** Read BidNet's public Massachusetts open-bids list, following its own pagination. */
export const fetchMaBidnetBids = group.fetchBids;
