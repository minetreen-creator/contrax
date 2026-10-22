/**
 * BidNet Direct — "Alabama Purchasing Group" — `al_bidnet`, the general-procurement bid surface
 * BidNet runs for Alabama, alongside (never instead of) any Alabama state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/alabama/solicitations/open-bids
 * Its heading read `15 Open Solicitations` over 1 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Alabama's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Alabama`) is its
 * `location` (class STATE scoped to AL); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = albidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Alabama board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const AL_BIDNET_SOURCE = "al_bidnet";
export const AL_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const AL_BIDNET_ID_PREFIX = "albidnet";
/** The engine default; 1 page(s) held the whole group on 2026-10-22. */
export const AL_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const AL_BIDNET_AGENCY = "Alabama Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Alabama Purchasing Group. */
export const AL_BIDNET_LIST_URL = `${AL_BIDNET_ORIGIN}/alabama/solicitations/open-bids`;

const AL_BIDNET_CONFIG: BidNetGroupConfig = {
  source: AL_BIDNET_SOURCE,
  idPrefix: AL_BIDNET_ID_PREFIX,
  slug: "alabama",
  stateName: "Alabama",
  groupName: "Alabama Purchasing Group",
};

const group = createBidNetGroup(AL_BIDNET_CONFIG);

if (group.listUrl !== AL_BIDNET_LIST_URL)
  throw new Error("al_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== AL_BIDNET_AGENCY)
  throw new Error("al_bidnet: agency label does not match BidNet's group name");

export type AlBidnetRow = BidNetRow;
export type AlBidnetParseResult = BidNetParseResult;

export const alBidnetListShapeOk = group.listShapeOk;
export const alBidnetStatedOpenCount = group.statedOpenCount;
export const parseAlBidnetPageLinks = group.parsePageLinks;
export const parseAlBidnetRows = group.parseRows;

/** PURE parse of the Alabama list rows — no network, no DB; `now` is injected. */
export const parseAlBidnet = group.parse;

/** Read BidNet's public Alabama open-bids list, following its own pagination. */
export const fetchAlBidnetBids = group.fetchBids;
