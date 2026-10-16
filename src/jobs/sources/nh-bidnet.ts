/**
 * BidNet Direct — "New Hampshire Purchasing Group" — `nh_bidnet`, New
 * Hampshire's general-procurement bid surface (the *backdoor* around a state
 * portal that cannot be read).
 *
 * WHY: New Hampshire's official procurement surfaces are unreachable from
 * Contrax's ingestion network — every `nh.gov` host tried (`www.nh.gov`,
 * `www.nh.gov/dot`, `www.nh.gov/das`, `www.nh.gov/das/purchasing`,
 * `apps.nh.gov/das/bids`, the legacy `das.nh.gov`) answers **HTTP 403** to a
 * plain GET with either a desktop-browser or a bot User-Agent, from this
 * sandbox (verified 2026-10-12; see
 * shared/nh-bids-discovery-2026-10-12/EVIDENCE.md). NH's central procurement
 * (DAS Bureau of Purchase and Property) and NHDOT lettings are therefore
 * UNVERIFIED — not proven to be dated readable surfaces, just unread. The
 * third-party aggregator BidNet Direct runs a *New Hampshire Purchasing Group*
 * listing NH-located solicitations and IS readable, so it is the source Contrax
 * ships; the official portal is NOT faked or guessed at.
 *
 * SOURCE (verified live 2026-10-12, no login, no CAPTCHA, no JavaScript, no
 * cookies): BidNet Direct's public "open bids" list for the NH purchasing group
 *   GET https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids
 * Its heading stated `91 Open Solicitations` and its own page selector
 * advertised 4 pages (25 + 25 + 25 + 16 rows, disjoint) = the 91 it claims.
 *
 * The reader itself lives in the shared `bidnet-direct.ts` engine (every BidNet
 * purchasing group uses the same server-rendered "mets" markup and the same URL
 * pagination); this file is the NEW HAMPSHIRE CONFIG plus the exported names the
 * NH fixtures, tests and live gate are written against. `sd_bidnet` is the same
 * engine with a different config.
 *
 * HONESTY — see `bidnet-direct.ts` for the binding contract. In short: BidNet is
 * a third-party aggregator (agencies self-post, and neither the badge nor any row
 * claims the State of New Hampshire operates it), only public no-login pages are
 * read, the members-only cells (issuing organization, solicitation number,
 * description, source) stay NULL, dates come from the source's own text
 * (date-only → 11:59 PM Eastern, the LATE bound), `estimated_value` is
 * "Not specified", and `category` is Contrax's own classification of the title.
 *
 * IDENTITY: `external_id = nhbidnet-<BidNet's own solicitation id>`. `sd_bidnet`
 * and `nh_bidnet` are separate sources with separate prefixes, so a solicitation
 * republished by different groups stays two publishers' listings — the same rule
 * that keeps `va_eva` and the locality boards apart.
 */
import {
  createBidNetGroup,
  BIDNET_MAX_PAGES,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const NH_BIDNET_SOURCE = "nh_bidnet";
export const NH_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const NH_BIDNET_ID_PREFIX = "nhbidnet";
/**
 * Hard cap on pages read in one pass. Pagination is self-describing (the page
 * lists its own page numbers), so this only bounds a pathological or looping
 * page — 4 pages held the whole NH group on 2026-10-12.
 */
export const NH_BIDNET_MAX_PAGES = BIDNET_MAX_PAGES;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const NH_BIDNET_AGENCY =
  "New Hampshire Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's New Hampshire Purchasing Group. */
export const NH_BIDNET_LIST_URL = `${NH_BIDNET_ORIGIN}/new-hampshire/solicitations/open-bids`;

const NH_BIDNET_CONFIG: BidNetGroupConfig = {
  source: NH_BIDNET_SOURCE,
  idPrefix: NH_BIDNET_ID_PREFIX,
  slug: "new-hampshire",
  stateName: "New Hampshire",
  groupName: "New Hampshire Purchasing Group",
};

const group = createBidNetGroup(NH_BIDNET_CONFIG);

if (group.listUrl !== NH_BIDNET_LIST_URL)
  throw new Error("nh_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== NH_BIDNET_AGENCY)
  throw new Error("nh_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the NH list page, exactly as the page prints it. */
export type NhBidnetRow = BidNetRow;
export type NhBidnetParseResult = BidNetParseResult;

export const nhBidnetListShapeOk = group.listShapeOk;
export const nhBidnetStatedOpenCount = group.statedOpenCount;
export const nhBidnetAbsoluteUrl = group.absoluteUrl;
export const parseNhBidnetPageLinks = group.parsePageLinks;
export const nhBidnetDetailId = group.detailId;
export const parseNhBidnetRows = group.parseRows;
export const nhBidnetDueMs = group.dueMs;
export const nhBidnetDateKey = group.dateKey;

/** PURE parse of the NH list rows — no network, no DB; `now` is injected. */
export const parseNhBidnet = group.parse;

/**
 * Read BidNet's public New Hampshire open-bids list, following its own
 * pagination, and return one bid per solicitation. ZERO rows is honest-empty
 * (0 rows), never a failure; a page that lost its shape, or a heading that claims
 * solicitations the rows did not deliver, FAILS instead of reading as empty.
 */
export const fetchNhBidnetBids = group.fetchBids;
