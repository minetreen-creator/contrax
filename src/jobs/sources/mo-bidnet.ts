/**
 * BidNet Direct — "Missouri Purchasing Group" — `mo_bidnet`, the general-procurement bid surface
 * BidNet runs for Missouri, alongside (never instead of) any Missouri state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/missouri/solicitations/open-bids
 * Its heading read `428 Open Solicitations` over 18 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Missouri's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Missouri`) is its
 * `location` (class STATE scoped to MO); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = mobidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Missouri board.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const MO_BIDNET_SOURCE = "mo_bidnet";
export const MO_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const MO_BIDNET_ID_PREFIX = "mobidnet";
/** The engine default; 18 page(s) held the whole group on 2026-10-22. */
export const MO_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const MO_BIDNET_AGENCY = "Missouri Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Missouri Purchasing Group. */
export const MO_BIDNET_LIST_URL = `${MO_BIDNET_ORIGIN}/missouri/solicitations/open-bids`;

const MO_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MO_BIDNET_SOURCE,
  idPrefix: MO_BIDNET_ID_PREFIX,
  slug: "missouri",
  stateName: "Missouri",
  groupName: "Missouri Purchasing Group",
};

const group = createBidNetGroup(MO_BIDNET_CONFIG);

if (group.listUrl !== MO_BIDNET_LIST_URL)
  throw new Error("mo_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== MO_BIDNET_AGENCY)
  throw new Error("mo_bidnet: agency label does not match BidNet's group name");

export type MoBidnetRow = BidNetRow;
export type MoBidnetParseResult = BidNetParseResult;

export const moBidnetListShapeOk = group.listShapeOk;
export const moBidnetStatedOpenCount = group.statedOpenCount;
export const parseMoBidnetPageLinks = group.parsePageLinks;
export const parseMoBidnetRows = group.parseRows;

/** PURE parse of the Missouri list rows — no network, no DB; `now` is injected. */
export const parseMoBidnet = group.parse;

/** Read BidNet's public Missouri open-bids list, following its own pagination. */
export const fetchMoBidnetBids = group.fetchBids;
