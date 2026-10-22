/**
 * BidNet Direct — "Oklahoma Purchasing Group" — `ok_bidnet`, the general-procurement bid surface
 * BidNet runs for Oklahoma, alongside (never instead of) any Oklahoma state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/oklahoma/solicitations/open-bids
 * Its heading read `22 Open Solicitations` over 1 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Oklahoma's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Oklahoma`) is its
 * `location` (class STATE scoped to OK); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = okbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Oklahoma board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const OK_BIDNET_SOURCE = "ok_bidnet";
export const OK_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const OK_BIDNET_ID_PREFIX = "okbidnet";
/** The engine default; 1 page(s) held the whole group on 2026-10-22. */
export const OK_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const OK_BIDNET_AGENCY = "Oklahoma Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Oklahoma Purchasing Group. */
export const OK_BIDNET_LIST_URL = `${OK_BIDNET_ORIGIN}/oklahoma/solicitations/open-bids`;

const OK_BIDNET_CONFIG: BidNetGroupConfig = {
  source: OK_BIDNET_SOURCE,
  idPrefix: OK_BIDNET_ID_PREFIX,
  slug: "oklahoma",
  stateName: "Oklahoma",
  groupName: "Oklahoma Purchasing Group",
};

const group = createBidNetGroup(OK_BIDNET_CONFIG);

if (group.listUrl !== OK_BIDNET_LIST_URL)
  throw new Error("ok_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== OK_BIDNET_AGENCY)
  throw new Error("ok_bidnet: agency label does not match BidNet's group name");

export type OkBidnetRow = BidNetRow;
export type OkBidnetParseResult = BidNetParseResult;

export const okBidnetListShapeOk = group.listShapeOk;
export const okBidnetStatedOpenCount = group.statedOpenCount;
export const parseOkBidnetPageLinks = group.parsePageLinks;
export const parseOkBidnetRows = group.parseRows;

/** PURE parse of the Oklahoma list rows — no network, no DB; `now` is injected. */
export const parseOkBidnet = group.parse;

/** Read BidNet's public Oklahoma open-bids list, following its own pagination. */
export const fetchOkBidnetBids = group.fetchBids;
