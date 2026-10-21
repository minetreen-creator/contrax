/**
 * BidNet Direct — "Virginia & DC Purchasing Group" — `va_bidnet`, the
 * general-procurement bid surface BidNet runs for Virginia and the District of
 * Columbia, alongside (never instead of) Virginia's own portal `va_eva`.
 *
 * WHY: BidNet denied Contrax API access on 2026-10-20, but the product never
 * needed it — every BidNet purchasing group publishes the SAME public,
 * login-free "open bids" list the shared `bidnet-direct.ts` engine already reads
 * for `sd_bidnet` and `nh_bidnet`. This file is the THIRD config for that engine
 * (one config object, no new parser, no new dependency, no API key).
 *
 * WHY A SECOND VIRGINIA-source SURFACE AT ALL: `va_eva` reads eVA, the
 * Commonwealth's OWN procurement portal (state + local Virginia buyers);
 * `va_evirginia` is the federal SAM.gov pass restricted to Virginia place of
 * performance (`va-` prefix). BidNet's Virginia & DC group is a THIRD,
 * complementary surface: a private aggregator on which Virginia AND District of
 * Columbia agencies self-post, and which additionally carries DC solicitations
 * that no Virginia portal lists. It is NOT the state's portal and is never
 * claimed to be — see HONESTY below.
 *
 * SOURCE (verified live 2026-10-21 from this sandbox, no login, no CAPTCHA, no
 * JavaScript, no cookies, no POST):
 *   GET https://www.bidnetdirect.com/virginia/solicitations/open-bids
 * Its results header read `1,176 Open Solicitations` (note the thousands
 * separator — `statedOpenCount` reads the comma form) and its own page selector
 * advertised 48 pages: 47 pages of 25 + a last page of 1 = 1,176, which is what
 * the heading claims. Page 1 carried 25 rows, regions `Virginia` (23) and
 * `District of Columbia` (2). A plain `curl/8.5.0` User-Agent is refused (HTTP
 * 403) by BidNet's bot wall from this egress — for EVERY group, including the
 * already-live South Dakota list — so the engine's browser-like User-Agent +
 * Accept + Referer (see its `getHtml`) is what the reader uses; that same fetch
 * is proven live for SD/NH in production.
 *
 * MAX PAGES: this group is far larger than the SD (2 pages) or NH (4 pages)
 * groups, and the engine's default cap of 20 pages would silently truncate it
 * to the first 500 rows, so the cap is raised to 150 here (≈3,750 rows of
 * headroom over the 48 pages measured today; reads at the ≈1 s/page this
 * network measures would reach the engine's 120 s per-pass budget near ~110
 * pages, and a pass that large FAILS CLOSED rather than truncating silently).
 * The pagination is self-describing: a page's own selector lists every page
 * number, so this only bounds a pathological or looping page — it never
 * invents pages.
 *
 * HONESTY — see `bidnet-direct.ts` for the binding contract. In short: BidNet is
 * a THIRD-PARTY aggregator (bidnetdirect.com, not a .gov host; agencies
 * self-post) and is NOT the Commonwealth of Virginia's — or the District of
 * Columbia's — procurement portal; only the public, login-free pages are read;
 * the members-only cells (issuing organization, solicitation number,
 * description, source) stay NULL and the description says why; dates come from
 * the source's own text (date-only → 11:59 PM Eastern, the LATE bound);
 * `estimated_value` is "Not specified"; and `category` is Contrax's OWN
 * classification of the title, never presented as the source's.
 *
 * REGION / DC ROWS: the engine stores each row's OWN region text as
 * `location` — this group prints `Virginia` on most rows and `District of
 * Columbia` on the rest, so a DC row is stored as District of Columbia (it is a
 * DC-located solicitation and the source says so), never relabelled Virginia and
 * never dropped. The source's class is still STATE scoped to VA (see
 * `src/lib/source-class.ts`) because the group is a Virginia-scoped surface. The
 * engine's description template names "the State of Virginia's procurement
 * portal" as the thing BidNet is not; for a DC row that sentence is still true
 * (Virginia's portal is not BidNet), and the row's own region text carries the
 * DC fact.
 *
 * IDENTITY: `external_id = vabidnet-<BidNet's own solicitation id>` (the numeric
 * id in the row's detail URL, e.g. `vabidnet-444205866429`). Never positional, so
 * a re-read can never write a second row and a reordering cannot repoint one.
 * `va_eva` (`eva-` prefix) and `va_evirginia` (`va-` prefix) are DIFFERENT
 * sources and are untouched: the same work republished here is a second
 * publisher's listing and is stored as its own row, exactly as `va_eva`
 * coexists with the Virginia locality boards.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const VA_BIDNET_SOURCE = "va_bidnet";
export const VA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const VA_BIDNET_ID_PREFIX = "vabidnet";
/**
 * Hard cap on pages read in one pass. Pagination is self-describing (the page
 * lists its own page numbers), so this only bounds a pathological or looping
 * page — the group held 1,176 open solicitations over 48 pages on 2026-10-21,
 * far past the engine default (`BIDNET_MAX_PAGES` = 20), which would truncate it.
 */
export const VA_BIDNET_MAX_PAGES = 150;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const VA_BIDNET_AGENCY =
  "Virginia & DC Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's Virginia & DC Purchasing Group. */
export const VA_BIDNET_LIST_URL = `${VA_BIDNET_ORIGIN}/virginia/solicitations/open-bids`;

const VA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: VA_BIDNET_SOURCE,
  idPrefix: VA_BIDNET_ID_PREFIX,
  slug: "virginia",
  stateName: "Virginia",
  groupName: "Virginia & DC Purchasing Group",
  maxPages: VA_BIDNET_MAX_PAGES,
};

const group = createBidNetGroup(VA_BIDNET_CONFIG);

if (group.listUrl !== VA_BIDNET_LIST_URL)
  throw new Error("va_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== VA_BIDNET_AGENCY)
  throw new Error("va_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the Virginia & DC list page, as the page prints it. */
export type VaBidnetRow = BidNetRow;
export type VaBidnetParseResult = BidNetParseResult;

export const vaBidnetListShapeOk = group.listShapeOk;
export const vaBidnetStatedOpenCount = group.statedOpenCount;
export const vaBidnetAbsoluteUrl = group.absoluteUrl;
export const parseVaBidnetPageLinks = group.parsePageLinks;
export const vaBidnetDetailId = group.detailId;
export const parseVaBidnetRows = group.parseRows;
export const vaBidnetDueMs = group.dueMs;
export const vaBidnetDateKey = group.dateKey;

/** PURE parse of the Virginia & DC list rows — no network, no DB; `now` is injected. */
export const parseVaBidnet = group.parse;

/**
 * Read BidNet's public Virginia & DC open-bids list, following its own
 * pagination, and return one bid per solicitation. ZERO rows is honest-empty
 * (0 rows), never a failure; a page that lost its shape, or a heading that claims
 * solicitations the rows did not deliver, FAILS instead of reading as empty.
 */
export const fetchVaBidnetBids = group.fetchBids;
