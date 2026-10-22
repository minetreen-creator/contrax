/**
 * BidNet Direct — "Ohio Purchasing Group" — `oh_bidnet`, the
 * general-procurement bid surface BidNet runs for Ohio, alongside (never
 * instead of) the Ohio DOT lettings (`oh_odot`) and the Ohio city/county boards.
 *
 * WHY: owner 2026-10-22 ("do all 3": Texas, Ohio, Pennsylvania, the largest
 * BidNet groups after California). The NINTH config of the shared
 * `bidnet-direct.ts` engine (one config object, no new parser, no API key).
 * Ohio cities, counties, school districts and authorities self-post here.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/ohio/solicitations/open-bids
 * Its heading read `1,452 Open Solicitations` and its own page selector
 * advertised 59 pages; every row on pages 1 and 2 reads region `Ohio` and
 * links with the `/public/supplier/solicitations/<scope>/<id>/abstract` shape.
 *
 * MAX PAGES / PASS BUDGET: 59 pages is past the engine's default cap (40),
 * so — like `ca_bidnet` (99 pages) — this group sets its own cap of 150 and its own
 * 240 s per-pass abort (≈1.3 s/page measured on the CA pass). A pass that still
 * overruns FAILS CLOSED rather than reporting a partial group.
 *
 * HONESTY, REGION, BOT WALL — exactly as `ca-bidnet.ts` / `ny-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Ohio's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region
 * text is its `location` (class STATE scoped to OH); a non-200 (including the AWS
 * WAF 202 challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = ohbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from `oh_odot`: the same work republished here is a second publisher's
 * listing and is stored as its own row.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const OH_BIDNET_SOURCE = "oh_bidnet";
export const OH_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const OH_BIDNET_ID_PREFIX = "ohbidnet";
/** 59 pages on 2026-10-22, past the engine default (40); see the header. */
export const OH_BIDNET_MAX_PAGES = 150;
/** Per-pass abort for THIS group (engine default 120 s); see the header. */
export const OH_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const OH_BIDNET_AGENCY = "Ohio Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Ohio Purchasing Group. */
export const OH_BIDNET_LIST_URL = `${OH_BIDNET_ORIGIN}/ohio/solicitations/open-bids`;

const OH_BIDNET_CONFIG: BidNetGroupConfig = {
  source: OH_BIDNET_SOURCE,
  idPrefix: OH_BIDNET_ID_PREFIX,
  slug: "ohio",
  stateName: "Ohio",
  groupName: "Ohio Purchasing Group",
  maxPages: OH_BIDNET_MAX_PAGES,
  passTimeoutMs: OH_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(OH_BIDNET_CONFIG);

if (group.listUrl !== OH_BIDNET_LIST_URL)
  throw new Error("oh_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== OH_BIDNET_AGENCY)
  throw new Error("oh_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the Ohio list page, as the page prints it. */
export type OhBidnetRow = BidNetRow;
export type OhBidnetParseResult = BidNetParseResult;

export const ohBidnetListShapeOk = group.listShapeOk;
export const ohBidnetStatedOpenCount = group.statedOpenCount;
export const ohBidnetAbsoluteUrl = group.absoluteUrl;
export const parseOhBidnetPageLinks = group.parsePageLinks;
export const ohBidnetDetailId = group.detailId;
export const parseOhBidnetRows = group.parseRows;
export const ohBidnetDueMs = group.dueMs;
export const ohBidnetDateKey = group.dateKey;

/** PURE parse of the Ohio list rows — no network, no DB; `now` is injected. */
export const parseOhBidnet = group.parse;

/**
 * Read BidNet's public Ohio open-bids list, following its own pagination, and
 * return one bid per solicitation. ZERO rows is honest-empty, never a failure; a
 * page that lost its shape, a non-200, or a heading that claims solicitations
 * the rows did not deliver FAILS instead of reading as empty.
 */
export const fetchOhBidnetBids = group.fetchBids;
