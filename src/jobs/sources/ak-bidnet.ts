/**
 * BidNet Direct — "Alaska Purchasing Group" — `ak_bidnet`, the general-procurement bid surface
 * BidNet runs for Alaska, alongside (never instead of) any Alaska state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/alaska/solicitations/open-bids
 * Its heading read `92 Open Solicitations` over 4 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Alaska's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Alaska`) is its
 * `location` (class STATE scoped to AK); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = akbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Alaska board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const AK_BIDNET_SOURCE = "ak_bidnet";
export const AK_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const AK_BIDNET_ID_PREFIX = "akbidnet";
/** The engine default; 4 page(s) held the whole group on 2026-10-22. */
export const AK_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const AK_BIDNET_AGENCY = "Alaska Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Alaska Purchasing Group. */
export const AK_BIDNET_LIST_URL = `${AK_BIDNET_ORIGIN}/alaska/solicitations/open-bids`;

const AK_BIDNET_CONFIG: BidNetGroupConfig = {
  source: AK_BIDNET_SOURCE,
  idPrefix: AK_BIDNET_ID_PREFIX,
  slug: "alaska",
  stateName: "Alaska",
  groupName: "Alaska Purchasing Group",
};

const group = createBidNetGroup(AK_BIDNET_CONFIG);

if (group.listUrl !== AK_BIDNET_LIST_URL)
  throw new Error("ak_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== AK_BIDNET_AGENCY)
  throw new Error("ak_bidnet: agency label does not match BidNet's group name");

export type AkBidnetRow = BidNetRow;
export type AkBidnetParseResult = BidNetParseResult;

export const akBidnetListShapeOk = group.listShapeOk;
export const akBidnetStatedOpenCount = group.statedOpenCount;
export const parseAkBidnetPageLinks = group.parsePageLinks;
export const parseAkBidnetRows = group.parseRows;

/** PURE parse of the Alaska list rows — no network, no DB; `now` is injected. */
export const parseAkBidnet = group.parse;

/** Read BidNet's public Alaska open-bids list, following its own pagination. */
export const fetchAkBidnetBids = group.fetchBids;
