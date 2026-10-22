/**
 * BidNet Direct — "Maine Purchasing Group" — `me_bidnet`, the general-procurement bid surface
 * BidNet runs for Maine, alongside (never instead of) any Maine state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/maine/solicitations/open-bids
 * Its heading read `93 Open Solicitations` over 4 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Maine's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Maine`) is its
 * `location` (class STATE scoped to ME); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mebidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Maine board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const ME_BIDNET_SOURCE = "me_bidnet";
export const ME_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const ME_BIDNET_ID_PREFIX = "mebidnet";
/** The engine default; 4 page(s) held the whole group on 2026-10-22. */
export const ME_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const ME_BIDNET_AGENCY = "Maine Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Maine Purchasing Group. */
export const ME_BIDNET_LIST_URL = `${ME_BIDNET_ORIGIN}/maine/solicitations/open-bids`;

const ME_BIDNET_CONFIG: BidNetGroupConfig = {
  source: ME_BIDNET_SOURCE,
  idPrefix: ME_BIDNET_ID_PREFIX,
  slug: "maine",
  stateName: "Maine",
  groupName: "Maine Purchasing Group",
};

const group = createBidNetGroup(ME_BIDNET_CONFIG);

if (group.listUrl !== ME_BIDNET_LIST_URL)
  throw new Error("me_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== ME_BIDNET_AGENCY)
  throw new Error("me_bidnet: agency label does not match BidNet's group name");

export type MeBidnetRow = BidNetRow;
export type MeBidnetParseResult = BidNetParseResult;

export const meBidnetListShapeOk = group.listShapeOk;
export const meBidnetStatedOpenCount = group.statedOpenCount;
export const parseMeBidnetPageLinks = group.parsePageLinks;
export const parseMeBidnetRows = group.parseRows;

/** PURE parse of the Maine list rows — no network, no DB; `now` is injected. */
export const parseMeBidnet = group.parse;

/** Read BidNet's public Maine open-bids list, following its own pagination. */
export const fetchMeBidnetBids = group.fetchBids;
