/**
 * BidNet Direct — "Illinois Purchasing Group" — `il_bidnet`, the general-procurement bid surface
 * BidNet runs for Illinois, alongside (never instead of) any Illinois state or local
 * board Contrax already reads.
 *
 * WHY: owner 2026-10-22 ("we need more states if we are going to do this deal").
 * One of 38 groups added together as configs of the shared `bidnet-direct.ts`
 * engine (one config object each, no new parser, no API key).
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/illinois/solicitations/open-bids
 * Its heading read `909 Open Solicitations` over 37 page(s).
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` / `ca-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Illinois's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region text (`Illinois`) is its
 * `location` (class STATE scoped to IL); a non-200 (including the AWS WAF 202
 * challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ilbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from every other Illinois board.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const IL_BIDNET_SOURCE = "il_bidnet";
export const IL_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const IL_BIDNET_ID_PREFIX = "ilbidnet";
/** 37 pages on 2026-10-22, near the engine default (40), so this group sets its own. */
export const IL_BIDNET_MAX_PAGES = 150;
/** Per-pass abort for THIS group (engine default 120 s). */
export const IL_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const IL_BIDNET_AGENCY = "Illinois Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Illinois Purchasing Group. */
export const IL_BIDNET_LIST_URL = `${IL_BIDNET_ORIGIN}/illinois/solicitations/open-bids`;

const IL_BIDNET_CONFIG: BidNetGroupConfig = {
  source: IL_BIDNET_SOURCE,
  idPrefix: IL_BIDNET_ID_PREFIX,
  slug: "illinois",
  stateName: "Illinois",
  groupName: "Illinois Purchasing Group",
  maxPages: IL_BIDNET_MAX_PAGES,
  passTimeoutMs: IL_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(IL_BIDNET_CONFIG);

if (group.listUrl !== IL_BIDNET_LIST_URL)
  throw new Error("il_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== IL_BIDNET_AGENCY)
  throw new Error("il_bidnet: agency label does not match BidNet's group name");

export type IlBidnetRow = BidNetRow;
export type IlBidnetParseResult = BidNetParseResult;

export const ilBidnetListShapeOk = group.listShapeOk;
export const ilBidnetStatedOpenCount = group.statedOpenCount;
export const parseIlBidnetPageLinks = group.parsePageLinks;
export const parseIlBidnetRows = group.parseRows;

/** PURE parse of the Illinois list rows — no network, no DB; `now` is injected. */
export const parseIlBidnet = group.parse;

/** Read BidNet's public Illinois open-bids list, following its own pagination. */
export const fetchIlBidnetBids = group.fetchBids;
