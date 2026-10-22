/**
 * BidNet Direct — "Georgia Purchasing Group" — `ga_bidnet`, the general-procurement bid surface
 * BidNet runs for Georgia, alongside (never instead of) any Georgia state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/georgia/solicitations/open-bids
 * Its heading read `509 Open Solicitations` over 21 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Georgia's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Georgia`) is its
 * `location` (class STATE scoped to GA); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = gabidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Georgia board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const GA_BIDNET_SOURCE = "ga_bidnet";
export const GA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const GA_BIDNET_ID_PREFIX = "gabidnet";
/** The engine default; 21 page(s) held the whole group on 2026-10-22. */
export const GA_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const GA_BIDNET_AGENCY = "Georgia Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Georgia Purchasing Group. */
export const GA_BIDNET_LIST_URL = `${GA_BIDNET_ORIGIN}/georgia/solicitations/open-bids`;

const GA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: GA_BIDNET_SOURCE,
  idPrefix: GA_BIDNET_ID_PREFIX,
  slug: "georgia",
  stateName: "Georgia",
  groupName: "Georgia Purchasing Group",
};

const group = createBidNetGroup(GA_BIDNET_CONFIG);

if (group.listUrl !== GA_BIDNET_LIST_URL)
  throw new Error("ga_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== GA_BIDNET_AGENCY)
  throw new Error("ga_bidnet: agency label does not match BidNet's group name");

export type GaBidnetRow = BidNetRow;
export type GaBidnetParseResult = BidNetParseResult;

export const gaBidnetListShapeOk = group.listShapeOk;
export const gaBidnetStatedOpenCount = group.statedOpenCount;
export const parseGaBidnetPageLinks = group.parsePageLinks;
export const parseGaBidnetRows = group.parseRows;

/** PURE parse of the Georgia list rows — no network, no DB; `now` is injected. */
export const parseGaBidnet = group.parse;

/** Read BidNet's public Georgia open-bids list, following its own pagination. */
export const fetchGaBidnetBids = group.fetchBids;
