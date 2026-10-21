/**
 * BidNet Direct — "California Purchasing Group" — `ca_bidnet`, the
 * general-procurement bid surface BidNet runs for California, alongside (never
 * instead of) the state's own portal `ca_eprocure`.
 *
 * WHY: BidNet denied Contrax API access on 2026-10-20, but the product never
 * needed it — every BidNet purchasing group publishes the SAME public,
 * login-free "open bids" list the shared `bidnet-direct.ts` engine already reads
 * for `sd_bidnet`, `nh_bidnet` and `va_bidnet`. This file is the FOURTH config
 * for that engine (one config object, no new parser, no new dependency, no API
 * key).
 *
 * WHY A SECOND CALIFORNIA-source SURFACE AT ALL: `ca_eprocure` reads Cal
 * eProcure, the State of California's OWN procurement portal (state + local
 * California buyers); this is a THIRD-PARTY aggregator surface on which
 * California agencies (state, county, city, special district) self-post, and
 * which carries solicitations the state portal does not. It is NOT the state's
 * portal and is never claimed to be — see HONESTY below.
 *
 * SOURCE (verified live 2026-10-21 from this sandbox, no login, no CAPTCHA, no
 * JavaScript, no cookies, no POST):
 *   GET https://www.bidnetdirect.com/california/solicitations/open-bids
 * Its results header read `2,468 Open Solicitations` (note the thousands
 * separator — `statedOpenCount` reads the comma form) and its own page selector
 * advertised 99 pages: 98 pages of 25 + a last page of 18 = 2,468, which is what
 * the heading claims. Page 1 carried 25 rows, every one reading region
 * `California`. A plain `curl/8.5.0` User-Agent is refused (HTTP 403) by
 * BidNet's bot wall from this egress — for EVERY group, including the
 * already-live South Dakota list — so the engine's browser-like User-Agent +
 * Accept + Referer (see its `getHtml`) is what the reader uses; that same fetch
 * is proven live for SD/NH/VA in production.
 *
 * MAX PAGES: this is the LARGEST group the engine reads — 2,468 open
 * solicitations over 99 pages on 2026-10-21, against SD's 2 pages, NH's 4 and
 * Virginia's 48 — and the engine's default cap of 20 pages would silently
 * truncate it to the first 500 rows, so the cap is raised to 150 here (≈3,750
 * rows of headroom over the 99 pages measured today). The cap never invents
 * pages: the pagination is self-describing (a page's own selector lists every
 * page number), so this only bounds a pathological or looping page.
 *
 * PASS BUDGET: at the ≈1 s/page this network measures, plus the engine's 300 ms
 * politeness delay, a full 99-page pass is ≈100–120 s — right at the engine's
 * default 120 s per-pass abort, which would cut the group off (fail-closed, no
 * rows) on a slightly slower pass. So this config alone raises the pass timeout
 * to 240 s (`passTimeoutMs`); every other group keeps the 120 s default
 * untouched. A pass that still exceeds it FAILS CLOSED rather than truncating
 * silently — the connector never reports a partial group as the whole group.
 *
 * HONESTY — see `bidnet-direct.ts` for the binding contract. In short: BidNet is
 * a THIRD-PARTY aggregator (bidnetdirect.com, not a .gov host; agencies
 * self-post) and is NOT the State of California's procurement portal; only the
 * public, login-free pages are read; the members-only cells (issuing
 * organization, solicitation number, description, source) stay NULL and the
 * description says why; dates come from the source's own text (date-only →
 * 11:59 PM Eastern, the LATE bound); `estimated_value` is "Not specified"; and
 * `category` is Contrax's OWN classification of the title, never presented as
 * the source's.
 *
 * REGION: the engine stores each row's OWN region text as `location`. On every
 * captured page that text is `California`, so a row is stored as California; the
 * source's class is STATE scoped to CA (see `src/lib/source-class.ts`).
 *
 * IDENTITY: `external_id = cabidnet-<BidNet's own solicitation id>` (the numeric
 * id in the row's detail URL, e.g. `cabidnet-444205866429`). Never positional, so
 * a re-read can never write a second row and a reordering cannot repoint one.
 * `ca_eprocure` (`ca_eprocure` source name, no BidNet prefix) is a DIFFERENT
 * source and is untouched: the same work republished here is a second
 * publisher's listing and is stored as its own row, exactly as `va_eva`
 * coexists with `va_bidnet`.
 */
import {
  createBidNetGroup,
  BIDNET_ORIGIN,
  type BidNetGroupConfig,
  type BidNetParseResult,
  type BidNetRow,
} from "./bidnet-direct";

export const CA_BIDNET_SOURCE = "ca_bidnet";
export const CA_BIDNET_ORIGIN = BIDNET_ORIGIN;
export const CA_BIDNET_ID_PREFIX = "cabidnet";
/**
 * Hard cap on pages read in one pass. Pagination is self-describing (the page
 * lists its own page numbers), so this only bounds a pathological or looping
 * page — the group held 2,468 open solicitations over 99 pages on 2026-10-21,
 * far past the engine default (`BIDNET_MAX_PAGES` = 20), which would truncate it.
 */
export const CA_BIDNET_MAX_PAGES = 150;
/**
 * Per-pass abort for THIS group. The engine default (120 s) is sized for SD/NH/VA
 * (≤ 48 pages); this group's 99 pages at ≈1 s/page plus the engine's 300 ms
 * politeness delay land right on that line, so the group gets 240 s and still
 * FAILS CLOSED past it — never a silent partial read.
 */
export const CA_BIDNET_PASS_TIMEOUT_MS = 240_000;
/** The buyer-side fact the public page actually supports (see the engine header). */
export const CA_BIDNET_AGENCY = "California Purchasing Group (BidNet Direct)";
/** The public open-bids list for BidNet's California Purchasing Group. */
export const CA_BIDNET_LIST_URL = `${CA_BIDNET_ORIGIN}/california/solicitations/open-bids`;

const CA_BIDNET_CONFIG: BidNetGroupConfig = {
  source: CA_BIDNET_SOURCE,
  idPrefix: CA_BIDNET_ID_PREFIX,
  slug: "california",
  stateName: "California",
  groupName: "California Purchasing Group",
  maxPages: CA_BIDNET_MAX_PAGES,
  passTimeoutMs: CA_BIDNET_PASS_TIMEOUT_MS,
};

const group = createBidNetGroup(CA_BIDNET_CONFIG);

if (group.listUrl !== CA_BIDNET_LIST_URL)
  throw new Error("ca_bidnet: list URL does not match BidNet's group slug");
if (group.agency !== CA_BIDNET_AGENCY)
  throw new Error("ca_bidnet: agency label does not match BidNet's group name");

/** One solicitation row of the California list page, as the page prints it. */
export type CaBidnetRow = BidNetRow;
export type CaBidnetParseResult = BidNetParseResult;

export const caBidnetListShapeOk = group.listShapeOk;
export const caBidnetStatedOpenCount = group.statedOpenCount;
export const caBidnetAbsoluteUrl = group.absoluteUrl;
export const parseCaBidnetPageLinks = group.parsePageLinks;
export const caBidnetDetailId = group.detailId;
export const parseCaBidnetRows = group.parseRows;
export const caBidnetDueMs = group.dueMs;
export const caBidnetDateKey = group.dateKey;

/** PURE parse of the California list rows — no network, no DB; `now` is injected. */
export const parseCaBidnet = group.parse;

/**
 * Read BidNet's public California open-bids list, following its own pagination,
 * and return one bid per solicitation. ZERO rows is honest-empty (0 rows), never
 * a failure; a page that lost its shape, or a heading that claims solicitations
 * the rows did not deliver, FAILS instead of reading as empty.
 */
export const fetchCaBidnetBids = group.fetchBids;
