/**
 * eVA — Virginia Business Opportunities (VBO), the Commonwealth's OWN
 * procurement portal (`va_eva`).
 *
 * WHY: every Virginia state agency, public university, locality and authority
 * posts its solicitations on eVA — including the Norfolk Airport Authority and
 * the Virginia Port Authority, neither of which publishes to SAM.gov. Before
 * this source, Contrax had NO state/local Virginia feed at all: the label
 * `va_evirginia` is a FEDERAL SAM.gov pass (see va-ev.ts / source-class.ts), so
 * e.g. RFP-FY27-800-02 (Norfolk Airport unarmed security) was invisible.
 *
 * SOURCE (verified live 2026-10-01, no auth, no CAPTCHA): the public "All
 * Opportunities" page (`/Vendor/public/AllOpportunities.jsp`) is a React app
 * that reads a public Solr endpoint, `solrconnect.jsp`, with standard Solr
 * query params and `wt=json`. This connector sends the SAME query the page
 * sends (q=*:*, an `fq` on status "Open", `sort=pubdate desc,id desc`, cursor
 * paging on the unique `id`), so it reads exactly what any visitor sees.
 *
 * WHAT A ROW BECOMES (data honesty — never manufacture, relabel, or loosen):
 *   - `title`       = `shortdesc` (the buyer's own title, verbatim).
 *   - `agency`      = `agencyname` (the buying entity, verbatim).
 *   - `description` = `longdesc`, or a plain pointer to eVA when empty.
 *   - `location`    = `workloc` when it reads as Virginia; "<workloc>,
 *                     Virginia" when it names no state; otherwise "Virginia".
 *                     Every eVA buyer is a Virginia public body, so VA is the
 *                     provable home jurisdiction (SOURCE_HOME_JURISDICTIONS).
 *                     Street and county names ("Washington Street", "Maryland
 *                     Avenue", "Hollins RD NE") must not move a Virginia bid to
 *                     another state, so such text falls back to "Virginia".
 *   - `due_date`    = `closedate` via the shared `toIsoDueDate` (parse or NULL).
 *   - `set_aside`   = eVA's SWaM priority (`setasideshortdesc`, e.g. "Small
 *                     Priority") labelled as a Virginia SWaM priority, or NULL.
 *                     It is a STATE small-business preference, never a federal
 *                     certification.
 *   - `notice_type` = `doccddesc` (e.g. "Request for Proposals (RFP)").
 *   - `source_url`  = the opportunity's public eVA detail page, built exactly
 *                     as eVA's own UI builds it (`getSoDetailUrl`).
 *   - `naics_code` / `psc` / `solicitation_number` stay NULL: eVA exposes none.
 *
 * WHAT IS SKIPPED (reason-coded, never silently): non-Open status, a close
 * date already past, sole-source notices (nothing to bid on), and the
 * non-procurement categories Surplus (the buyer SELLS), Grant Opportunity
 * (not a contract) and Real Property (leases/sales).
 *
 * ENCODING: eVA double-encodes some UTF-8 text ("Mooreâ\u0080\u0099s" for
 * "Moore’s"). `fixMojibake` reverses that only when the round-trip is clean.
 *
 * IDENTITY: `external_id = eva-<id>` (eVA's own unique Solr id, e.g.
 * "IV128951"). An amended solicitation keeps its id and bumps `version`, so the
 * upsert key (source, external_id) REFRESHES the row instead of duplicating it.
 *
 * ── OPEN-SET SCOPE: `app:IV` ONLY (2026-10-08, owner spec) ───────────────────
 * The index carries TWO applications. `app:IV` (~44.7k docs) is the LIVE
 * solicitation index; `app:VBO` (~106k docs) is the ARCHIVED legacy VBO, frozen
 * in 2023 and never maintained — its `status` field still says "Open" on one
 * 2022-era notice whose close date is 2026-08-01 (`VBO:IFQC:A208:170594`).
 * A query on `status:Open` ALONE therefore spans both apps: measured on
 * 2026-10-08, `status:Open` over the whole index = 575 while
 * `app:IV AND status:Open` = 574 — the delta is exactly that one archived row.
 * This connector queries `app:IV` explicitly (`EVA_OPEN_QUERY`) so an archived
 * row can never be ingested as open. `status` is never trusted on its own.
 *
 * ── CLOSE-DATE TIME ZONE: AS PUBLISHED, UNVERIFIED (owner-flagged 2026-10-08) ─
 * eVA states its deadlines in EASTERN time, but the values the Solr proxy serves
 * carry a bare `Z` (e.g. `2026-10-16T11:00:00Z`) — i.e. the wire says UTC while
 * the source publishes ET. Whether the stored value is a true UTC instant or an
 * ET wall-clock mislabelled `Z` was NOT established by the 2026-10-08 probe, so
 * — same class as the Bonfire `DateClose` zone flag, and by owner direction —
 * this connector does NOT shift, convert or re-label it. `toIsoDueDate` reads the
 * value exactly as the source states it (a bare `Z` is a real instant to the
 * runtime) and `VA_EVA_COPY.timeZoneNote` discloses the open question wherever
 * this source's rows are described. Countdown/"due in N days" labels for these
 * rows are NOT settled: the surfaces that render a countdown (dashboard feed,
 * tracking, map) derive it from `due_date` alone and their row payloads do not
 * carry `source`, so a source-scoped suppression needs a data-plumbing change on
 * those surfaces — deliberately NOT made here (no product-surface change in this
 * PR). `VA_EVA_DUE_DATE_ZONE_UNVERIFIED` is the flag a future surface must read.
 */
import { mapCategory } from "~/lib/trade-classification";
import { resolveStateFromText } from "~/lib/location-state";
import { toIsoDueDate } from "~/lib/date";
import type { FetchResult } from "../runner";
import {
  httpFailureDetail,
  requestFailureDetail,
  SourceUnreachableError,
} from "../fetch-failure";
import type { RawBid } from "./sam-gov";

export const EVA_ORIGIN = "https://mvendor.cgieva.com";
export const EVA_SOLR_ENDPOINT = `${EVA_ORIGIN}/Vendor/public/solrconnect.jsp`;
export const EVA_PUBLIC_PAGE = `${EVA_ORIGIN}/Vendor/public/AllOpportunities.jsp`;

/** Browser-like headers: eVA answers a bare client with an empty 202. */
export const EVA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: EVA_PUBLIC_PAGE,
} as const;

/** Rows per Solr page. ~600 open opportunities today → ~6 polite requests. */
export const EVA_PAGE_SIZE = 100;
/** Hard ceiling on pages per sync, so a cursor bug can never loop forever. */
export const EVA_MAX_PAGES = 30;
const EVA_PAGE_DELAY_MS = 300;

/**
 * The ONLY application this connector ingests. `app:VBO` (106k docs) is the
 * archived legacy VBO, frozen in 2023, whose `status` field is unmaintained —
 * ingesting it as "open" would be false (see the header). Never widen this.
 */
export const EVA_APP = "IV";

/**
 * The hard-coded open-set query (owner spec 2026-10-08). It is asserted verbatim
 * in the live source-validation gate, so a silent loosening of the open set —
 * e.g. dropping `closedate:[NOW TO *]` and re-admitting rows that already closed,
 * or dropping `app:IV` and re-admitting the archived VBO row — turns that gate
 * red instead of quietly changing what Contrax calls an open Virginia bid.
 */
export const EVA_OPEN_QUERY = `app:${EVA_APP} AND status:Open AND closedate:[NOW TO *]`;

/**
 * eVA's malformed-query signature: HTTP 200 with a tiny NON-JSON body (measured
 * 5 bytes, five newlines, when a space is sent as `+` instead of `%20`). It is not
 * an error status and not `numFound:0` — a naive reader would store zero rows and
 * log success. Anything below this many bytes fails closed with the real reason.
 */
export const EVA_MIN_BODY_BYTES = 20;

/**
 * The due-date time zone is NOT settled for this source (owner-noted 2026-10-08):
 * eVA publishes Eastern Time but serves a bare `Z`. Contrax stores the value as
 * published and never converts it. A surface that renders a countdown ("due in
 * N days") must read this flag and suppress the label for this source's rows
 * until the question is settled against a detail page.
 */
export const VA_EVA_DUE_DATE_ZONE_UNVERIFIED = true;

/**
 * THE COPY (owner-honest wording; exported so a surface, an alert or a run record
 * quotes the same sentence, and so a count line can only be built from numbers a
 * REAL run produced). Verbatim source copy, no coverage claim.
 */
export const VA_EVA_COPY = {
  publisherLine:
    "Virginia state and local solicitations as published on eVA, the Commonwealth's procurement portal.",
  /** The badge comes from `source-class.ts` (STATE → "State (VA)"); pinned here too. */
  badge: "State (VA)",
  openSetDefinition:
    "Every open eVA solicitation whose close date has not passed is included — state agencies, public universities and authorities, and the Virginia localities that publish through eVA. Sole-source notices and the non-procurement categories (surplus, grant opportunity, real property) are excluded.",
  buyerMixNote:
    "eVA hosts solicitations for Virginia state agencies and public universities and authorities, and for Virginia cities, counties, towns, school divisions, transit and regional bodies that publish through it. The buying entity is shown exactly as the source states it; a locality's row is not a state-agency row.",
  timeZoneNote:
    "Close dates are shown as eVA publishes them. eVA states its deadlines in Eastern Time, but the values it serves carry a bare 'Z' marker, so the time zone is not settled: Contrax stores the value exactly as published, never shifted, and does not show a countdown for these rows.",
  noClaimsLine:
    "Contrax checks this source on a schedule, but does not warrant that every Virginia solicitation is listed. Always confirm details and deadlines at the official source.",
} as const;

/**
 * The live-count honesty line. `count` MUST be the number of open rows a REAL run
 * read; `asOf` is that run's own "last checked" stamp. Never hardcode a number
 * beside this string.
 */
export function vaEvaCountLine(count: number, asOf: Date | string): string {
  const stamped =
    typeof asOf === "string"
      ? asOf
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(asOf)
          .replace(",", "");
  return `eVA listed ${count} open Virginia solicitations · last checked by Contrax ${stamped} ET.`;
}

/** Categories that are not something a contractor bids to perform/supply. */
const NON_PROCUREMENT_CATEGORIES = new Set(["surplus", "grant opportunity", "real property"]);
/** Notice types with nothing to bid on. */
const NON_BIDDABLE_DOCCDS = new Set(["SS"]);
/** Work-location placeholders that carry no place at all. */
const PLACEHOLDER_WORKLOC = /^(see attach\w*|see (the )?solicitation|tbd|n\/?a|none|various|unknown)\b/i;

/** One Solr document as eVA returns it (only the fields this connector reads). */
export interface EvaDoc {
  id?: string;
  app?: string;
  doccd?: string;
  doccddesc?: string;
  docdeptcd?: string;
  externalid?: string;
  internalid?: string;
  version?: string;
  agencyname?: string;
  shortdesc?: string;
  longdesc?: string;
  workloc?: string;
  closedate?: string;
  status?: string;
  category?: string;
  setasideshortdesc?: string;
}

export interface EvaSolrResponse {
  response?: { numFound?: number; docs?: EvaDoc[] };
  nextCursorMark?: string;
}

export interface EvaParseResult {
  rows: RawBid[];
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

/**
 * Undo eVA's double UTF-8 encoding ("â\u0080\u0099" → "’"). Only applied when
 * the text looks double-encoded AND re-decoding produces no replacement
 * characters — otherwise the original text is returned untouched.
 */
export function fixMojibake(text: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(text)) return text;
  if (/[^\u0000-ÿ]/.test(text)) return text; // already real Unicode
  const decoded = Buffer.from(text, "latin1").toString("utf8");
  return decoded.includes("�") ? text : decoded;
}

function clean(value: string | null | undefined): string {
  return fixMojibake(String(value ?? ""))
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Place of performance. Every eVA buyer is a Virginia public body, so the
 * result always resolves to VA on the shared resolver:
 *   - text that already reads as Virginia is kept verbatim;
 *   - text naming no state (e.g. "HRSD", "Norfolk Airport Authority") gets
 *     ", Virginia" appended;
 *   - a placeholder ("See attached solicitation"), or text the resolver would
 *     misread as another state ("201 W. Washington Street, Petersburg, VA"),
 *     becomes plain "Virginia".
 */
export function evaLocation(workloc: string | null | undefined): string {
  const text = clean(workloc).slice(0, 200).trim();
  if (!text || PLACEHOLDER_WORKLOC.test(text)) return "Virginia";
  const state = resolveStateFromText(text);
  if (state === "VA") return text;
  if (state) return "Virginia";
  const appended = `${text.replace(/[,;.\s]+$/, "")}, Virginia`;
  return resolveStateFromText(appended) === "VA" ? appended : "Virginia";
}

/** eVA's SWaM priority, labelled as what it is (a Virginia state preference). */
export function evaSetAside(setAsideShort: string | null | undefined): string | null {
  const text = clean(setAsideShort);
  return text ? `Virginia SWaM: ${text}` : null;
}

/** The public eVA detail page, built exactly as eVA's own UI builds it. */
export function evaDetailUrl(doc: EvaDoc): string | null {
  const q = (params: Record<string, string>) =>
    Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
  const base = `${EVA_ORIGIN}/Vendor/public`;
  const internal = doc.internalid ?? "";
  const external = doc.externalid ?? "";
  const version = doc.version ?? "0";
  switch (doc.app) {
    case "IV":
      if (!internal) return null;
      return `${base}/IVDetails.jsp?${q({ PageTitle: "SO Details", rfp_id_lot: internal, rfp_id_round: version })}`;
    case "QQ":
      if (!external) return null;
      return `${base}/QQDetails.jsp?${q({ PageTitle: "QQ Details", REQUEST_ID: external })}`;
    case "VBO":
    case "ADV": {
      if (!internal || !external || !doc.doccd || !doc.docdeptcd) return null;
      const page = doc.app === "VBO" ? "VBODetails.jsp" : "ADVSODetails.jsp";
      const details = doc.app === "VBO" ? "VBOSODetails.jsp" : "ADVSODetails.jsp";
      return `${base}/${page}?${q({
        PageTitle: "SO Details",
        DOC_CD: doc.doccd,
        Details_Page: details,
        DEPT_CD: doc.docdeptcd,
        BID_INTRNL_NO: internal,
        BID_NO: external,
        BID_VERS_NO: version,
      })}`;
    }
    default:
      return null;
  }
}

function recordSkip(result: EvaParseResult, id: string, reason: string) {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  result.skippedRows.push({ id, reason });
}

/**
 * PURE page parse — no network, no DB. `now` is injected so the `closed`
 * guard never depends on the wall clock in tests.
 */
export function parseEvaDocs(docs: readonly EvaDoc[], now: number = Date.now()): EvaParseResult {
  const result: EvaParseResult = { rows: [], skipped: {}, skippedRows: [] };
  for (const doc of docs) {
    const id = clean(doc.id);
    if (!id) {
      recordSkip(result, "eva-unknown", "missing_id");
      continue;
    }
    const rowId = `eva-${id}`;
    const title = clean(doc.shortdesc);
    if (!title) {
      recordSkip(result, rowId, "missing_title");
      continue;
    }
    if (clean(doc.status).toLowerCase() !== "open") {
      recordSkip(result, rowId, "not_open");
      continue;
    }
    // SCOPE, BELT-AND-BRACES: the query is `app:IV` (see the header), so an
    // archived-app row should never arrive — but `app:VBO`'s `status` field is
    // unmaintained and still reads "Open" on one 2022-era notice, so if the query
    // is ever loosened the row is refused HERE too rather than stored as open.
    if (doc.app && clean(doc.app).toUpperCase() !== EVA_APP) {
      recordSkip(result, rowId, "wrong_app");
      continue;
    }
    if (NON_BIDDABLE_DOCCDS.has(clean(doc.doccd).toUpperCase())) {
      recordSkip(result, rowId, "sole_source");
      continue;
    }
    if (NON_PROCUREMENT_CATEGORIES.has(clean(doc.category).toLowerCase())) {
      recordSkip(result, rowId, "non_procurement");
      continue;
    }
    const due = toIsoDueDate(doc.closedate ?? null);
    // AS PUBLISHED, NEVER SHIFTED (owner flag 2026-10-08): eVA serves a bare `Z`
    // on a source that publishes Eastern Time. `toIsoDueDate` is the runtime's
    // own parse of exactly what the source said — no zone conversion, no
    // inference — and the open question is disclosed in
    // VA_EVA_COPY.timeZoneNote / VA_EVA_DUE_DATE_ZONE_UNVERIFIED.
    if (due && Date.parse(due) < now) {
      recordSkip(result, rowId, "closed");
      continue;
    }
    const sourceUrl = evaDetailUrl(doc);
    if (!sourceUrl) {
      recordSkip(result, rowId, "missing_detail_link");
      continue;
    }
    const agency = clean(doc.agencyname) || "Commonwealth of Virginia (eVA)";
    const description =
      clean(doc.longdesc) ||
      `Open ${agency} solicitation posted on eVA, Virginia's procurement portal. Full details and documents are on eVA (see source link).`;

    result.rows.push({
      external_id: rowId,
      title,
      agency,
      description,
      location: evaLocation(doc.workloc),
      category: mapCategory("", title, description),
      due_date: due,
      estimated_value: "Not specified",
      source_url: sourceUrl,
      set_aside: evaSetAside(doc.setasideshortdesc),
      notice_type: clean(doc.doccddesc) || null,
      // eVA exposes none of these; NULL means "not supplied", never guessed.
      naics_code: null,
      psc: null,
      solicitation_number: null,
    });
  }
  return result;
}

/**
 * The Solr query string for one page. `q` is the hard-coded open-set query
 * (`EVA_OPEN_QUERY`, `app:IV` scoped — see the header); paging is the Solr
 * CURSOR (`cursorMark`, sorted on a unique final key) rather than a numeric
 * `start` offset, because eVA's index is written continuously — an offset into a
 * shifting result set can skip or repeat rows between requests, while a cursor
 * cannot. Every space is percent-encoded by `encodeURIComponent` (a literal `+`
 * makes eVA answer HTTP 200 with a 5-byte body — see `EVA_MIN_BODY_BYTES`).
 */
export function evaQueryUrl(cursorMark: string, rows: number = EVA_PAGE_SIZE): string {
  const params = [
    `q=${encodeURIComponent(EVA_OPEN_QUERY)}`,
    `sort=${encodeURIComponent("closedate asc,id asc")}`,
    `rows=${rows}`,
    "wt=json",
    `cursorMark=${encodeURIComponent(cursorMark)}`,
  ];
  return `${EVA_SOLR_ENDPOINT}?${params.join("&")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url: string): Promise<EvaSolrResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp: Response;
  try {
    resp = await fetch(url, { headers: EVA_HEADERS, signal: controller.signal });
  } catch (e) {
    const detail = requestFailureDetail(e);
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  } finally {
    clearTimeout(timer);
  }
  // eVA answers some clients with an empty 202 instead of data — that is a
  // failed read, never an honest empty board.
  if (resp.status !== 200) {
    const detail = httpFailureDetail(resp.status, EVA_SOLR_ENDPOINT);
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  const text = await resp.text();
  // THE MEASURED TRAP: a malformed query (e.g. a space sent as `+`) is answered
  // with HTTP 200 and a 5-byte body of newlines — not an error status, not
  // `numFound:0`. Fail closed with the real reason rather than reading it as an
  // empty board. Checked before JSON.parse so the log line says what happened.
  if (text.length < EVA_MIN_BODY_BYTES) {
    const detail = `response body too small to be a Solr result (${text.length} bytes, expected >= ${EVA_MIN_BODY_BYTES}) — eVA's malformed-query signature`;
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  let body: EvaSolrResponse;
  try {
    body = JSON.parse(text);
  } catch {
    const detail = `response was not JSON (${text.length} bytes)`;
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  if (!Array.isArray(body?.response?.docs)) {
    const detail = "response shape changed: no response.docs array";
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  return body;
}

/**
 * Fetch every open eVA opportunity (cursor-paged) and return ingest rows. Any
 * HTTP/network/shape failure throws `SourceUnreachableError`, which the runner
 * records per source (DEAD tier) without aborting the sync.
 *
 * TWO FAIL-CLOSED GATES on the read itself (owner spec 2026-10-08), because a
 * partial or misread page must never be written as "the open Virginia set":
 *   ① `numFound` is 0 or absent. `EVA_OPEN_QUERY` is a query eVA always has rows
 *      for (~574 on 2026-10-08); a zero total means the proxy or the query
 *      changed, not that Virginia has no open work.
 *   ② the documents actually read do NOT equal the total the source reported
 *      (`numFound`). This is the anti-churn count gate: it catches a truncated
 *      read (cursor stopped early), a `rows` cap, and a silently altered open
 *      set, all of which would otherwise be stored as a smaller-but-plausible
 *      corpus. `numFound` is taken from the FIRST page and re-checked on later
 *      pages; a later page disagreeing with it is itself a shape failure.
 */
export async function fetchVaEvaBids(now: number = Date.now()): Promise<FetchResult> {
  const docs: EvaDoc[] = [];
  let cursor = "*";
  let numFound: number | null = null;
  for (let page = 0; page < EVA_MAX_PAGES; page++) {
    const body = await fetchPage(evaQueryUrl(cursor));
    const pageDocs = body.response!.docs!;
    const pageTotal = body.response?.numFound;
    if (numFound === null && typeof pageTotal === "number") numFound = pageTotal;
    if (typeof pageTotal === "number" && numFound !== null && pageTotal !== numFound) {
      const detail = `count gate: page ${page + 1} reports numFound=${pageTotal} but page 1 reported ${numFound} — the open set moved mid-read`;
      console.error(`  va_eva: ${detail}`);
      throw new SourceUnreachableError("va_eva", [detail]);
    }
    docs.push(...pageDocs);
    const next = body.nextCursorMark;
    if (!next || next === cursor || pageDocs.length === 0) break;
    cursor = next;
    await sleep(EVA_PAGE_DELAY_MS);
  }
  if (!numFound) {
    const detail = `count gate: the open-set query reported numFound=${numFound ?? "absent"} — expected a positive total`;
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  if (docs.length !== numFound) {
    const detail = `count gate: read ${docs.length} documents but the source reported numFound=${numFound} — refusing a partial open set`;
    console.error(`  va_eva: ${detail}`);
    throw new SourceUnreachableError("va_eva", [detail]);
  }
  const { rows, skipped, skippedRows } = parseEvaDocs(docs, now);
  console.log(
    `  va_eva: ${rows.length} open opportunities accepted (read ${docs.length} of ${numFound}; skips: ${
      Object.entries(skipped)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ") || "none"
    })`,
  );
  return { rows, skipped, skippedRows };
}
