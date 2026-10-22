/**
 * BidNet Direct — "Pennsylvania Purchasing Group" — `pa_bidnet`, the
 * general-procurement bid surface BidNet runs for Pennsylvania, alongside (never
 * instead of) the DGS eMarketplace (`pa_dgs_emarketplace`) and PennBid.
 *
 * WHY: owner 2026-10-22 ("do all 3": Texas, Ohio, Pennsylvania, the largest
 * BidNet groups after California). The TENTH config of the shared
 * `bidnet-direct.ts` engine (one config object, no new parser, no API key).
 * Pennsylvania cities, counties, school districts and authorities self-post here.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/pennsylvania/solicitations/open-bids
 * Its heading read `1,263 Open Solicitations` and its own page selector
 * advertised 51 pages; every row on pages 1 and 2 reads region `Pennsylvania` and
 * links with the `/public/supplier/solicitations/<scope>/<id>/abstract` shape.
 *
 * MAX PAGES / PASS BUDGET: 51 pages is past the engine's default cap (40),
 * so — like `ca_bidnet` (99 pages) — this group sets its own cap of 150 and its own
 * 240 s per-pass abort (≈1.3 s/page measured on the CA pass). A pass that still
 * overruns FAILS CLOSED rather than reporting a partial group.
 *
 * HONESTY, REGION, BOT WALL — exactly as `ca-bidnet.ts` / `ny-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Pennsylvania's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region
 * text is its `location` (class STATE scoped to PA); a non-200 (including the AWS
 * WAF 202 challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = pabidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from `pa_dgs_emarketplace`: the same work republished here is a second publisher's
 * listing and is stored as its own row.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const PA_BIDNET_SOURCE = "pa_bidnet";
export const PA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const PA_BIDNET_ID_PREFIX = "pabidnet";
/** 51 pages on 2026-10-22, past the engine default (40); see the header. */
export const PA_BIDNET_MAX_PAGES = 150;
/** Per-pass abort for THIS group (engine default 120 s); see the header. */
export const PA_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const PA_BIDNET_AGENCY = "Pennsylvania Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Pennsylvania Purchasing Group. */
export const PA_BIDNET_LIST_URL = `${PA_BIDNET_ORIGIN}/pennsylvania/solicitations/open-bids`;

const PA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: PA_BIDNET_SOURCE,
  idPrefix: PA_BIDNET_ID_PREFIX,
  slug: "pennsylvania",
  stateName: "Pennsylvania",
  groupName: "Pennsylvania Purchasing Group",
  maxPages: PA_BIDNET_MAX_PAGES,
  passTimeoutMs: PA_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(PA_BIDNET_CONFIG);

if (group.listUrl !== PA_BIDNET_LIST_URL)
  throw new Error("pa_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== PA_BIDNET_AGENCY)
  throw new Error("pa_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the Pennsylvania list page, as the page prints it. */
export type PaBidnetRow = BidNetRow;
export type PaBidnetParseResult = BidNetParseResult;

export const paBidnetListShapeOk = group.listShapeOk;
export const paBidnetStatedOpenCount = group.statedOpenCount;
export const paBidnetAbsoluteUrl = group.absoluteUrl;
export const parsePaBidnetPageLinks = group.parsePageLinks;
export const paBidnetDetailId = group.detailId;
export const parsePaBidnetRows = group.parseRows;
export const paBidnetDueMs = group.dueMs;
export const paBidnetDateKey = group.dateKey;

/** PURE parse of the Pennsylvania list rows — no network, no DB; `now` is injected. */
export const parsePaBidnet = group.parse;

/**
 * Read BidNet's public Pennsylvania open-bids list, following its own pagination, and
 * return one bid per solicitation. ZERO rows is honest-empty, never a failure; a
 * page that lost its shape, a non-200, or a heading that claims solicitations
 * the rows did not deliver FAILS instead of reading as empty.
 */
export const fetchPaBidnetBids = group.fetchBids;
