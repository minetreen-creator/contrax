/**
 * BidNet Direct — "South Dakota Purchasing Group" — `sd_bidnet`, South Dakota's
 * general-procurement bid surface (the *backdoor* around the state's own portal).
 *
 * WHY: South Dakota's central procurement portal (the BHRA ServiceNow service
 * portal reached from boa.sd.gov) is a JavaScript SPA whose listings are
 * Knowledge Base articles: it publishes no dated solicitation records through any
 * endpoint Contrax may read (verified — see shared/sd-bids-discovery-2026-10-11/
 * EVIDENCE.md). The only other dated public surface is the third-party
 * aggregator BidNet Direct, which runs a *South Dakota Purchasing Group* listing
 * SD-located solicitations. `sd_dot` (SDDOT highway lettings) is the state DOT's
 * own site; this connector is the complementary GENERAL-PROCUREMENT source.
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA, no JavaScript, no
 * cookies): BidNet Direct's public "open bids" list for the SD purchasing group
 *   GET https://www.bidnetdirect.com/south-dakota/solicitations/open-bids
 * Its heading stated `44 Open Solicitations` on 2026-10-12 and its own page
 * selector advertised 2 pages (25 + 19 rows, disjoint) = the 44 it claims.
 *
 * The reader itself lives in the shared `bidnet-direct.ts` engine (every BidNet
 * purchasing group uses the same server-rendered "mets" markup and the same URL
 * pagination); this file is the SOUTH DAKOTA CONFIG plus the exported names the
 * SD fixtures, tests and live gate were written against. Behaviour is unchanged
 * from the original per-state implementation — `sd-bidnet.test.ts` pins it.
 *
 * HONESTY — see `bidnet-direct.ts` for the binding contract. In short: BidNet is
 * a third-party aggregator (agencies self-post), only public no-login pages are
 * read, the members-only cells stay NULL, dates come from the source's own text
 * (date-only → 11:59 PM Eastern, the LATE bound), and `category` is Contrax's own
 * classification of the title.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const SD_BIDNET_SOURCE = "sd_bidnet";
export const SD_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const SD_BIDNET_ID_PREFIX = "sdbidnet";
/**
 * Hard cap on pages read in one pass. Pagination is self-describing (the page
 * lists its own page numbers), so this only bounds a pathological or looping
 * page — 2 pages held the whole SD group on 2026-10-12.
 */
export const SD_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const SD_BIDNET_AGENCY = "South Dakota Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's South Dakota Purchasing Group. */
export const SD_BIDNET_LIST_URL = `${SD_BIDNET_ORIGIN}/south-dakota/solicitations/open-bids`;

const SD_BIDNET_CONFIG: BidNetGroupConfig = {
  source: SD_BIDNET_SOURCE,
  idPrefix: SD_BIDNET_ID_PREFIX,
  slug: "south-dakota",
  stateName: "South Dakota",
  groupName: "South Dakota Purchasing Group",
};

const group = createBidNetGroup(SD_BIDNET_CONFIG);

if (group.listUrl !== SD_BIDNET_LIST_URL)
  throw new Error("sd_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== SD_BIDNET_AGENCY)
  throw new Error("sd_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the SD list page, exactly as the page prints it. */
export type SdBidnetRow = BidNetRow;
export type SdBidnetParseResult = BidNetParseResult;

export const sdBidnetListShapeOk = group.listShapeOk;
export const sdBidnetStatedOpenCount = group.statedOpenCount;
export const sdBidnetAbsoluteUrl = group.absoluteUrl;
export const parseSdBidnetPageLinks = group.parsePageLinks;
export const sdBidnetDetailId = group.detailId;
export const parseSdBidnetRows = group.parseRows;
export const sdBidnetDueMs = group.dueMs;
export const sdBidnetDateKey = group.dateKey;

/** PURE parse of the SD list rows — no network, no DB; `now` is injected. */
export const parseSdBidnet = group.parse;

/**
 * Read BidNet's public South Dakota open-bids list, following its own pagination,
 * and return one bid per solicitation. ZERO rows is honest-empty (0 rows), never
 * a failure; a page that lost its shape, or a heading that claims solicitations
 * the rows did not deliver, FAILS instead of reading as empty.
 */
export const fetchSdBidnetBids = group.fetchBids;
