/**
 * BidNet Direct — "North Carolina Purchasing Group" — `nc_bidnet`, the
 * general-procurement bid surface BidNet runs for North Carolina, alongside
 * (never instead of) the state's own board `nc_evp` (the electronic Vendor
 * Portal) and the NC locality boards.
 *
 * WHY: owner 2026-10-22 ("after that NC"). The SEVENTH config of the shared
 * `bidnet-direct.ts` engine (one config object, no new parser, no API key).
 * North Carolina cities, counties and school systems self-post here.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA solved, no JavaScript,
 * no cookies, no POST):
 *   GET https://www.bidnetdirect.com/north-carolina/solicitations/open-bids
 * Its heading read `14 Open Solicitations` on a single page (no page selector),
 * every row region `North Carolina`, linked with the
 * `/<group>/solicitations/open-bids/<title-slug>/<id>` shape (see
 * `bidNetDetailId`). The first GET that day got the AWS WAF 202 challenge; the
 * next one returned the list (the engine fails a challenged pass closed).
 *
 * HONESTY, REGION, IDENTITY — exactly as `ny-bidnet.ts` / `fl-bidnet.ts`: a
 * THIRD-PARTY aggregator, NOT the State of North Carolina's portal; members-only
 * cells stay NULL; date-only deadlines at 11:59 PM Eastern; `category` is
 * Contrax's own classification of the title; class STATE scoped to NC;
 * `external_id = ncbidnet-<BidNet's own id>`, a SEPARATE source from `nc_evp`.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NC_BIDNET_SOURCE = "nc_bidnet";
export const NC_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NC_BIDNET_ID_PREFIX = "ncbidnet";
/** The engine default: 1 page held the whole NC group on 2026-10-22. */
export const NC_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NC_BIDNET_AGENCY = "North Carolina Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's North Carolina Purchasing Group. */
export const NC_BIDNET_LIST_URL = `${NC_BIDNET_ORIGIN}/north-carolina/solicitations/open-bids`;

const NC_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NC_BIDNET_SOURCE,
  idPrefix: NC_BIDNET_ID_PREFIX,
  slug: "north-carolina",
  stateName: "North Carolina",
  groupName: "North Carolina Purchasing Group",
};

const group = createBidNetGroup(NC_BIDNET_CONFIG);

if (group.listUrl !== NC_BIDNET_LIST_URL)
  throw new Error("nc_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NC_BIDNET_AGENCY)
  throw new Error("nc_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the NC list page, exactly as the page prints it. */
export type NcBidnetRow = BidNetRow;
export type NcBidnetParseResult = BidNetParseResult;

export const ncBidnetListShapeOk = group.listShapeOk;
export const ncBidnetStatedOpenCount = group.statedOpenCount;
export const ncBidnetAbsoluteUrl = group.absoluteUrl;
export const parseNcBidnetPageLinks = group.parsePageLinks;
export const ncBidnetDetailId = group.detailId;
export const parseNcBidnetRows = group.parseRows;
export const ncBidnetDueMs = group.dueMs;
export const ncBidnetDateKey = group.dateKey;

/** PURE parse of the NC list rows — no network, no DB; `now` is injected. */
export const parseNcBidnet = group.parse;

/**
 * Read BidNet's public North Carolina open-bids list, following its own pagination,
 * and return one bid per solicitation. ZERO rows is honest-empty, never a
 * failure; a page that lost its shape, a non-200 (including the bot wall's 202
 * challenge), or a heading that claims solicitations the rows did not deliver
 * FAILS instead of reading as empty.
 */
export const fetchNcBidnetBids = group.fetchBids;
