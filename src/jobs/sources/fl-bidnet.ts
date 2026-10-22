/**
 * BidNet Direct — "Florida Purchasing Group" — `fl_bidnet`, the
 * general-procurement bid surface BidNet runs for Florida, alongside (never
 * instead of) the state's own board `fl_mfmp` (MyFloridaMarketPlace's Vendor
 * Bid System).
 *
 * WHY: owner 2026-10-22 ("use the same scraper on FL"). Every BidNet purchasing
 * group publishes the SAME public, login-free "open bids" list the shared
 * `bidnet-direct.ts` engine reads for `sd_bidnet`, `nh_bidnet`, `va_bidnet`,
 * `ca_bidnet` and `ny_bidnet`; this file is the SIXTH config (one config object,
 * no new parser, no API key). Florida cities, counties, school districts and
 * authorities self-post here; MFMP carries the state agencies.
 *
 * SOURCE (verified live 2026-10-22, no login, no CAPTCHA, no JavaScript, no
 * cookies, no POST):
 *   GET https://www.bidnetdirect.com/florida/solicitations/open-bids
 * Its heading read `74 Open Solicitations` over 3 pages (25 + 25 + 24); every
 * row on pages 1 and 2 reads region `Florida`. Rows link with the same
 * `/<group>/solicitations/open-bids/<title-slug>/<id>` shape as `ny_bidnet`
 * (see `bidNetDetailId`). The engine's default page cap (40) and pass timeout
 * (120 s) cover it, so this config sets neither.
 *
 * HONESTY, REGION, BOT WALL — exactly as `ny-bidnet.ts` and the engine header:
 * BidNet is a THIRD-PARTY aggregator, NOT the State of Florida's procurement
 * portal; members-only cells stay NULL; date-only deadlines are stored at 11:59
 * PM Eastern; `category` is Contrax's own classification of the title; each
 * row's own region text is its `location` (class STATE scoped to FL); a non-200
 * (including the AWS WAF 202 challenge) fails the pass, never reads as empty.
 *
 * IDENTITY: `external_id = flbidnet-<BidNet's own solicitation id>`, a SEPARATE
 * source from `fl_mfmp`: the same work republished here is a second publisher's
 * listing and is stored as its own row.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const FL_BIDNET_SOURCE = "fl_bidnet";
export const FL_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const FL_BIDNET_ID_PREFIX = "flbidnet";
/** The engine default: 3 pages held the whole FL group on 2026-10-22. */
export const FL_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const FL_BIDNET_AGENCY = "Florida Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Florida Purchasing Group. */
export const FL_BIDNET_LIST_URL = `${FL_BIDNET_ORIGIN}/florida/solicitations/open-bids`;

const FL_BIDNET_CONFIG: BidNetGroupConfig = {
  source: FL_BIDNET_SOURCE,
  idPrefix: FL_BIDNET_ID_PREFIX,
  slug: "florida",
  stateName: "Florida",
  groupName: "Florida Purchasing Group",
};

const group = createBidNetGroup(FL_BIDNET_CONFIG);

if (group.listUrl !== FL_BIDNET_LIST_URL)
  throw new Error("fl_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== FL_BIDNET_AGENCY)
  throw new Error("fl_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the FL list page, exactly as the page prints it. */
export type FlBidnetRow = BidNetRow;
export type FlBidnetParseResult = BidNetParseResult;

export const flBidnetListShapeOk = group.listShapeOk;
export const flBidnetStatedOpenCount = group.statedOpenCount;
export const flBidnetAbsoluteUrl = group.absoluteUrl;
export const parseFlBidnetPageLinks = group.parsePageLinks;
export const flBidnetDetailId = group.detailId;
export const parseFlBidnetRows = group.parseRows;
export const flBidnetDueMs = group.dueMs;
export const flBidnetDateKey = group.dateKey;

/** PURE parse of the FL list rows — no network, no DB; `now` is injected. */
export const parseFlBidnet = group.parse;

/**
 * Read BidNet's public Florida open-bids list, following its own pagination,
 * and return one bid per solicitation. ZERO rows is honest-empty, never a
 * failure; a page that lost its shape, a non-200 (including the bot wall's 202
 * challenge), or a heading that claims solicitations the rows did not deliver
 * FAILS instead of reading as empty.
 */
export const fetchFlBidnetBids = group.fetchBids;
