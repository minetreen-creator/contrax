/**
 * BidNet Direct — "Kansas Purchasing Group" — `ks_bidnet`, the general-procurement bid surface
 * BidNet runs for Kansas, alongside (never instead of) any Kansas state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/kansas/solicitations/open-bids
 * Its heading read `160 Open Solicitations` over 7 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Kansas's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Kansas`) is its
 * `location` (class STATE scoped to KS); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ksbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Kansas board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const KS_BIDNET_SOURCE = "ks_bidnet";
export const KS_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const KS_BIDNET_ID_PREFIX = "ksbidnet";
/** The engine default; 7 page(s) held the whole group on 2026-10-22. */
export const KS_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const KS_BIDNET_AGENCY = "Kansas Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Kansas Purchasing Group. */
export const KS_BIDNET_LIST_URL = `${KS_BIDNET_ORIGIN}/kansas/solicitations/open-bids`;

const KS_BIDNET_CONFIG: BidNetGroupConfig = {
  source: KS_BIDNET_SOURCE,
  idPrefix: KS_BIDNET_ID_PREFIX,
  slug: "kansas",
  stateName: "Kansas",
  groupName: "Kansas Purchasing Group",
};

const group = createBidNetGroup(KS_BIDNET_CONFIG);

if (group.listUrl !== KS_BIDNET_LIST_URL)
  throw new Error("ks_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== KS_BIDNET_AGENCY)
  throw new Error("ks_bidnet: agency label does not match BidNet's group name");

export type KsBidnetRow = BidNetRow;
export type KsBidnetParseResult = BidNetParseResult;

export const ksBidnetListShapeOk = group.listShapeOk;
export const ksBidnetStatedOpenCount = group.statedOpenCount;
export const parseKsBidnetPageLinks = group.parsePageLinks;
export const parseKsBidnetRows = group.parseRows;

/** PURE parse of the Kansas list rows — no network, no DB; `now` is injected. */
export const parseKsBidnet = group.parse;

/** Read BidNet's public Kansas open-bids list, following its own pagination. */
export const fetchKsBidnetBids = group.fetchBids;
