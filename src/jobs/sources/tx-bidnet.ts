/**
 * BidNet Direct — "Texas Purchasing Group" — `tx_bidnet`, the
 * general-procurement bid surface BidNet runs for Texas, alongside (never
 * instead of) the Electronic State Business Daily (ESBD).
 *
 * WHY: owner 2026-10-22 ("do all 3": Texas, Ohio, Pennsylvania, the largest
 * BidNet groups after California). The EIGHTH config of the shared
 * `bidnet-direct.ts` engine (one config object, no new parser, no API key).
 * Texas cities, counties, school districts and authorities self-post here.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/texas/solicitations/open-bids
 * Its heading read `1,915 Open Solicitations` and its own page selector
 * advertised 77 pages; every row on pages 1 and 2 reads region `Texas` and
 * links with the `/public/supplier/solicitations/<scope>/<id>/abstract` shape.
 *
 * MAX PAGES / PASS BUDGET: 77 pages is past the engine's default cap (40),
 * so — like `ca_bidnet` (99 pages) — this group sets its own cap of 150 and its own
 * 240 s per-pass abort (≈1.3 s/page measured on the CA pass). A pass that still
 * overruns FAILS CLOSED rather than reporting a partial group.
 *
 * HONESTY, REGION, BOT WALL — exactly as `ca-bidnet.ts` / `ny-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of Texas's procurement portal;
 * members-only cells stay NULL; date-only deadlines at 11:59 PM Eastern;
 * `category` is Contrax's own classification of the title; each row's own region
 * text is its `location` (class STATE scoped to TX); a non-200 (including the AWS
 * WAF 202 challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = txbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from `tx_esbd`: the same work republished here is a second publisher's
 * listing and is stored as its own row.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const TX_BIDNET_SOURCE = "tx_bidnet";
export const TX_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const TX_BIDNET_ID_PREFIX = "txbidnet";
/** 77 pages on 2026-10-22, past the engine default (40); see the header. */
export const TX_BIDNET_MAX_PAGES = 150;
/** Per-pass abort for THIS group (engine default 120 s); see the header. */
export const TX_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const TX_BIDNET_AGENCY = "Texas Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Texas Purchasing Group. */
export const TX_BIDNET_LIST_URL = `${TX_BIDNET_ORIGIN}/texas/solicitations/open-bids`;

const TX_BIDNET_CONFIG: BidNetGroupConfig = {
  source: TX_BIDNET_SOURCE,
  idPrefix: TX_BIDNET_ID_PREFIX,
  slug: "texas",
  stateName: "Texas",
  groupName: "Texas Purchasing Group",
  maxPages: TX_BIDNET_MAX_PAGES,
  passTimeoutMs: TX_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(TX_BIDNET_CONFIG);

if (group.listUrl !== TX_BIDNET_LIST_URL)
  throw new Error("tx_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== TX_BIDNET_AGENCY)
  throw new Error("tx_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the Texas list page, as the page prints it. */
export type TxBidnetRow = BidNetRow;
export type TxBidnetParseResult = BidNetParseResult;

export const txBidnetListShapeOk = group.listShapeOk;
export const txBidnetStatedOpenCount = group.statedOpenCount;
export const txBidnetAbsoluteUrl = group.absoluteUrl;
export const parseTxBidnetPageLinks = group.parsePageLinks;
export const txBidnetDetailId = group.detailId;
export const parseTxBidnetRows = group.parseRows;
export const txBidnetDueMs = group.dueMs;
export const txBidnetDateKey = group.dateKey;

/** PURE parse of the Texas list rows — no network, no DB; `now` is injected. */
export const parseTxBidnet = group.parse;

/**
 * Read BidNet's public Texas open-bids list, following its own pagination, and
 * return one bid per solicitation. ZERO rows is honest-empty, never a failure; a
 * page that lost its shape, a non-200, or a heading that claims solicitations
 * the rows did not deliver FAILS instead of reading as empty.
 */
export const fetchTxBidnetBids = group.fetchBids;
