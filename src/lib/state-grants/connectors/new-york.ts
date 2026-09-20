/**
 * NEW YORK CONNECTOR — state grants NATIONWIDE workstream (owner order
 * 2026-09-20). NY is the follow-up the escalation pass named as the single
 * highest-value jurisdiction left (`state-grants-escalation-pass-2026-09-19.md`
 * §7.2 + §9), and the owner ruled on it explicitly (verbatim):
 *
 *   "Allow normal, temporary public-session cookies only—no login, CAPTCHA
 *    bypass, or persistent credential storage. Fail closed if the public session
 *    cannot be established."
 *
 * OFFICIAL SOURCE (hard-coded). New York's own Grants Management site names this
 * portal and links it directly:
 *
 *   listing  https://esupplier.sfs.ny.gov/psc/fscm/SUPPLIER/ERP/c/NY_SUPPUB_FL.AUC_RESP_INQ_AUC.GBL
 *   session  https://esupplier.sfs.ny.gov/psp/fscm/SUPPLIER/?cmd=login&languageCd=ENG&
 *
 * (both read off grantsmanagement.ny.gov/search-funding-sfs, the State's own
 * "Search for Funding in SFS" page). That page says of the portal, in its own
 * words: "The SFS Vendor Portal provides a one-stop-shop for anyone interested
 * in identifying New York State grant funding opportunities. Anyone can access
 * the Grant Opportunity Portal. A username and password are not necessary to
 * view anticipated and available grant opportunities."
 *
 * WHY THE PUBLIC-SESSION HANDSHAKE IS REQUIRED (verified live 2026-09-20). The
 * listing is an Oracle PeopleSoft component page served only inside a session:
 * a cookie-less GET of the listing URL answers **302** (381 bytes, no grid at
 * all), while a GET of the portal's own PUBLIC guest page first — and then the
 * listing with the cookies that page's response set — answers **200 / 100,823
 * bytes / `<title>Response Bid Inquiry</title>`** with a 22-row grid. Two
 * independent sessions produced the same 22 rows. The handshake is the shared
 * `fetchStateGrantSource()` opt-in described in `PublicSessionOptions`: GET,
 * public page, in-memory cookies for this run only, no credentials, no
 * persistence, fail-closed. Both requests stay on `esupplier.sfs.ny.gov`.
 *
 * WHAT THIS SOURCE IS: the State's own "Grant Opportunity Portal" — the
 * statewide, MULTI-AGENCY listing (its own "Funding Agency" column carries
 * AGM01, CFS01, DDP01, DEC01, DOH01, DOL01, OMH01, TDA01 …). It is still
 * served as ONE source, so the coverage tier is the conservative `limited` the
 * owner's own ruling assigns ("NY becomes `limited` on one statewide public
 * portal"), never `curated`/`connected` and never advertised as statewide
 * comprehensive coverage.
 *
 * WHAT IS READ, EXACTLY. One record per grid row, and only from the columns the
 * SOURCE ITSELF LABELS (the labels are read off the grid's own header cells, so
 * column ownership is structural, not positional):
 *   #0 "Event ID"               → the source's own id (the record's externalId)
 *   #1 "Funding Agency"         → kept verbatim in `raw.fundingAgency`
 *   #2 "Grant Opportunity"      → the record's title
 *   #3 "Status"                 → the source's own status words
 *   #4 "Eligibility"            → the record's `eligibleApplicants`, verbatim
 *   #8 "Due Date"               → the record's `closeDate` (see below)
 * The grid's own declared row count (`gridList_win0`) is cross-checked against
 * the number of rows parsed: a truncated grid is not a shorter listing, it is a
 * failed read.
 *
 * THE DUE DATE IS THE SOURCE'S ONLY CLOSE DATE. The cell ("10/08/2026 4:30PM
 * EDT") resolves to a single published day through the shared
 * `singlePublishedDay()` — if a cell ever published no day, or several different
 * days, the record is left undated rather than one of them being chosen.
 *
 * EVERY OTHER DATE IS REFUSED VERBATIM into `raw.refusedDates` with a reason.
 * That includes the grid's two other date columns, "Availability Date" (#6) and
 * "Anticipated Release Date" (#7): neither is a closing date, and an ANTICIPATED
 * date is by the source's own word an estimate, which this workstream never
 * promotes. So `postedDate` is null and `estimatedCloseDate` is null for every
 * record — this source publishes no posting date for a cycle and no estimate.
 *
 * STATUSES come from the shared classifier unchanged, with the source's own
 * Status cell as the only declared state: a cell whose own words mark the cycle
 * closed becomes `sourceClosed` (so the source's past-tense statement wins over
 * any date), a cell that declares the program ongoing/year-round/rolling becomes
 * `ongoing`, and otherwise a future published Due Date ⇒ `open`, a past one ⇒
 * `closed`. Absent a date and absent the source's own words ⇒ `unverified`.
 * `forecast` is not a status and never appears.
 *
 * ONE HONEST LIMITATION: a grid row's name cell is a PeopleSoft
 * `javascript:submitAction_win0(…)` post-back, not a URL, so there is NO static
 * per-opportunity URL to point at (`raw.perOpportunityUrlAvailable: false`).
 * Every record therefore links to the official portal page it was read from —
 * never to a third-party or invented address.
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  StateSourceError,
  fetchStateGrantSource,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

/** The official listing: NY's Grant Opportunity Portal inside the SFS Vendor Portal. */
export const NEW_YORK_SOURCE_URL =
  "https://esupplier.sfs.ny.gov/psc/fscm/SUPPLIER/ERP/c/NY_SUPPUB_FL.AUC_RESP_INQ_AUC.GBL";
/**
 * The portal's own PUBLIC guest/session page — the ONE handshake request. It is
 * fetched with a plain GET and no credentials; it exists to receive the
 * temporary public-session cookies the listing then requires.
 */
export const NEW_YORK_SESSION_URL =
  "https://esupplier.sfs.ny.gov/psp/fscm/SUPPLIER/?cmd=login&languageCd=ENG&";
export const NEW_YORK_SOURCE_HOST = "esupplier.sfs.ny.gov";
export const NEW_YORK_APPROVED_HOSTS: readonly string[] = ["esupplier.sfs.ny.gov"];
/** The publishing body, in the portal's own words. */
export const NEW_YORK_AGENCY = "New York State — Statewide Financial System (SFS) Vendor Portal";
export const NEW_YORK_SOURCE_NAME =
  "New York State Grant Opportunity Portal (SFS Vendor Portal)";
export const NEW_YORK_CONNECTOR_ID = "ny-sfs-grant-opportunity-portal";
export const NEW_YORK_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/new-york.source-validation.test.ts";

/**
 * A string only the portal's own component page carries (`szPinCrefLabel`, the
 * pinned component's own label in the PeopleSoft bootstrap JS): the fail-closed
 * marker the listing fetch checks.
 */
export const NEW_YORK_LISTING_MARKER = "Search for Grant Opportunities";
/** A string only the portal's public sign-in page carries. */
export const NEW_YORK_SESSION_MARKER = "PeopleSoft Sign-in";
/** The one cookie the listing depends on (verified live 2026-09-20). */
export const NEW_YORK_REQUIRED_COOKIES: readonly string[] = ["EE1VEND-PORTAL-PSJSESSIONID"];
/** The listing body is ~100 KB and declares 22 rows; this is the sane floor. */
export const NEW_YORK_LISTING_MIN_BYTES = 20_000;
/** The public session page is ~10.7 KB. */
export const NEW_YORK_SESSION_MIN_BYTES = 2_000;
/** The grid component's own row count declaration in the page's bootstrap JS. */
export const NEW_YORK_GRID_VIEW = "RESP_INQA_HD_VW_GR$0";
const NEW_YORK_GRID_VIEW_RE = "RESP_INQA_HD_VW_GR\\$0";

/**
 * The labels the SOURCE prints for its own grid columns, keyed by the column
 * index PeopleSoft uses in the cell ids (`td…$0#N`). Read off the header cells
 * of the fetched page — never hard-coded as a position.
 */
export function newYorkColumnLabels(html: string): Map<number, string> {
  const labels = new Map<number, string>();
  const re = new RegExp(
    `<th[^>]*id=['"]th${NEW_YORK_GRID_VIEW_RE}#(\\d+)['"][^>]*>([\\s\\S]*?)</th>`,
    "gi",
  );
  for (const m of html.matchAll(re)) {
    const label = stripTags(m[2] ?? "");
    if (label.length > 0) labels.set(Number(m[1]), label);
  }
  return labels;
}

/**
 * The source's own label of each column this connector is allowed to read, and
 * the PeopleSoft FIELD that column's cell value lives in. The binding is not
 * taken on trust: `parseNewYorkGrid()` re-derives it from the page's OWN two
 * declarations — the grid's header cells (`th…#N` → label) and the grid's own
 * `gridFieldList_win0` (column position → field) — and fails closed if they no
 * longer agree with this table.
 */
export const NEW_YORK_COLUMN_FIELD = {
  "Event ID": "AUC_ID_COL",
  "Funding Agency": "NY_AUC_INQ1_WRK_BUSINESS_UNIT",
  "Grant Opportunity": "AUC_NAME_LNK",
  Status: "NY_AUC_INQ1_WRK_NY_GG_PORT_STATUS",
  Eligibility: "NY_AUC_INQ1_WRK_FIELDLIST",
  "Availability Date": "RESP_INQA1_WK_AUC_DTTM_PREVIEW",
  "Anticipated Release Date": "RESP_INQA1_WK_AUC_DTTM_START",
  "Due Date": "RESP_INQA1_WK_AUC_DTTM_FINISH",
} as const;
/** The header label each value this connector publishes is read from. */
export const NEW_YORK_READ_COLUMN = {
  eventId: "Event ID",
  fundingAgency: "Funding Agency",
  title: "Grant Opportunity",
  status: "Status",
  eligibility: "Eligibility",
  availabilityDate: "Availability Date",
  anticipatedReleaseDate: "Anticipated Release Date",
  dueDate: "Due Date",
} as const;

/**
 * The column order the GRID ITSELF declares (`gridFieldList_win0`, the array
 * PeopleSoft uses to render it), with the `$new`/`$delete` row-control entries
 * dropped. Position i here is the same column as header slot i.
 */
export function newYorkGridFieldOrder(html: string): string[] {
  const at = html.indexOf("gridFieldList_win0");
  if (at === -1) return [];
  const rest = html.slice(at);
  const end = rest.search(/\n\]\s*;/);
  const window = end === -1 ? rest.slice(0, 4000) : rest.slice(0, end);
  const names = [...window.matchAll(/'([A-Za-z][A-Za-z0-9_$%]*)'/g)].map((m) => m[1]!);
  const fields: string[] = [];
  for (const name of names) {
    if (name.includes("$new") || name.includes("$delete")) continue;
    const field = name.replace(/\$%c$/, "");
    if (field.length === 0) continue;
    fields.push(field);
  }
  return fields;
}

/** The grid's own declared row count, or null when the payload omits it. */
export function newYorkDeclaredRowCount(html: string): number | null {
  const re = new RegExp(
    `gridList_win0\\s*=\\s*\\[[\\s\\S]*?\\['${NEW_YORK_GRID_VIEW_RE}'\\s*,\\s*\\d+\\s*,\\s*(\\d+)`,
  );
  const m = re.exec(html);
  return m ? Number(m[1]) : null;
}

/** The field names this connector may read a value out of. */
const READ_FIELDS: readonly string[] = Object.values(NEW_YORK_COLUMN_FIELD);

/**
 * ONE grid row's field values, keyed by the PeopleSoft field name — read from
 * each cell's OWN `<span id="FIELD$n">` (PeopleSoft renders the id on the span
 * for every row, including the even rows whose `<td>` carries no id at all, and
 * so column ownership does not depend on cell position).
 */
export function newYorkRowFields(rowHtml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<span[^>]*\bid=['"]([A-Za-z][A-Za-z0-9_]*)(?:\$span)?\$\d+['"][^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of rowHtml.matchAll(re)) {
    const field = m[1]!;
    if (out.has(field) || !READ_FIELDS.includes(field)) continue;
    out.set(field, stripTags(m[2] ?? ""));
  }
  return out;
}

/** The grid's own data rows, in the order the portal renders them. */
export function newYorkGridRows(html: string): string[] {
  const rows: string[] = [];
  const re = new RegExp(
    `<tr[^>]*\\bid=['"]tr${NEW_YORK_GRID_VIEW_RE}_row(\\d+)['"][^>]*>([\\s\\S]*?)(?=<tr[^>]*\\bid=['"]tr${NEW_YORK_GRID_VIEW_RE}_row|$)`,
    "gi",
  );
  for (const m of html.matchAll(re)) rows.push(m[2] ?? "");
  return rows;
}

/** One refused cell: the source's own text, a kind, and why it is not a date. */
export interface NewYorkRefusal {
  text: string;
  kind: string;
  reason: string;
}

/** The source's own slug for one of its Event IDs (stable across runs). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Parses the fetched portal grid into normalised, unclassified records. ONE
 * record per grid row the portal publishes, and the record's dates come only
 * from the column the source itself labels "Due Date".
 */
export function parseNewYorkGrid(raw: string): SourceGrantRecord[] {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateSourceError("parse", "New York payload is empty");
  }
  if (!raw.includes(NEW_YORK_LISTING_MARKER)) {
    throw new StateSourceError(
      "parse",
      `New York payload does not come from ${NEW_YORK_SOURCE_NAME}: it does not carry the portal's own ` +
        `"${NEW_YORK_LISTING_MARKER}" component label — refusing to parse it`,
    );
  }
  // Column ownership, re-derived from the SOURCE's own two declarations: the
  // header cells it prints (`th…#N` → label) zipped with the column order its
  // own `gridFieldList_win0` publishes (position → PeopleSoft field). Fail closed
  // if either is missing or if they disagree with this connector's own table —
  // then "the close date came from the column the source labels Due Date" is a
  // fact read off the page, not a restatement of a comment.
  const labelsByIndex = [...newYorkColumnLabels(raw)].sort((a, b) => a[0] - b[0]);
  const labelOrder = labelsByIndex.map(([, label]) => label);
  const fieldOrder = newYorkGridFieldOrder(raw);
  for (const label of new Set(Object.values(NEW_YORK_READ_COLUMN))) {
    const at = labelOrder.indexOf(label);
    if (at === -1) {
      throw new StateSourceError(
        "parse",
        `New York grid no longer publishes a "${label}" column (its own header is missing) — refusing to read dates off an unrecognised grid`,
      );
    }
    const declaredField = fieldOrder[at];
    if (declaredField !== NEW_YORK_COLUMN_FIELD[label]) {
      throw new StateSourceError(
        "parse",
        `New York grid's "${label}" column now maps to field ${JSON.stringify(declaredField)} in the portal's own grid declaration, not ${JSON.stringify(NEW_YORK_COLUMN_FIELD[label])} — refusing to read a column whose ownership changed`,
      );
    }
  }
  const rows = newYorkGridRows(raw);
  if (rows.length === 0) {
    throw new StateSourceError(
      "parse",
      `New York payload carried the portal's component label but no grid rows — a changed portal is not an empty listing`,
    );
  }
  const declared = newYorkDeclaredRowCount(raw);
  if (declared !== null && declared !== rows.length) {
    throw new StateSourceError(
      "parse",
      `New York grid declares ${declared} rows but only ${rows.length} were parsed — refusing a truncated listing`,
    );
  }

  const records: SourceGrantRecord[] = [];
  const nextId = uniqueExternalIdFactory();
  for (const rowHtml of rows) {
    const cells = newYorkRowFields(rowHtml);
    const cell = (field: keyof typeof NEW_YORK_READ_COLUMN): string =>
      cells.get(NEW_YORK_COLUMN_FIELD[NEW_YORK_READ_COLUMN[field]]) ?? "";
    const eventId = cell("eventId");
    const title = cell("title");
    // A row the portal renders without a name or an id is not an opportunity we
    // can attribute — fail closed rather than invent both.
    if (title.length === 0 && eventId.length === 0) continue;
    if (title.length === 0 || eventId.length === 0) {
      throw new StateSourceError(
        "parse",
        `New York grid row publishes ${title.length === 0 ? "no Grant Opportunity" : "no Event ID"} — an unattributable row is never served`,
      );
    }
    const statusText = cell("status");
    const dueText = cell("dueDate");
    const dueDay = singlePublishedDay(dueText);
    const availabilityText = cell("availabilityDate");
    const anticipatedText = cell("anticipatedReleaseDate");
    const refused: NewYorkRefusal[] = [];
    const refuse = (text: string, kind: string, reason: string): void => {
      const value = text.replace(/\s+/g, " ").trim();
      if (value.length === 0) return;
      if (refused.some((r) => r.text === value && r.kind === kind)) return;
      refused.push({ text: value, kind, reason });
    };
    refuse(
      availabilityText,
      "availability-date-column",
      'the source prints this in its own "Availability Date" column — a release/availability stamp is not a closing date, so it is never published as a posted or close date',
    );
    refuse(
      anticipatedText,
      "anticipated-release-date-column",
      'the source prints this in its own "Anticipated Release Date" column — the source\'s own word "anticipated" makes it an estimate, and this workstream never promotes an estimate into a date',
    );
    const eligibility = cell("eligibility");
    records.push({
      sourceKey: NEW_YORK_CONNECTOR_ID,
      stateCode: "NY",
      externalId: nextId(`${NEW_YORK_CONNECTOR_ID}-${slugify(eventId)}`),
      title,
      agency: NEW_YORK_AGENCY,
      summary: NOT_SPECIFIED,
      // The name cell is a PeopleSoft `javascript:` post-back, not a URL: the
      // record points at the official portal page it was read from.
      url: NEW_YORK_SOURCE_URL,
      sourceUrl: NEW_YORK_SOURCE_URL,
      // Neither of the source's two other date columns is a posting date (see
      // the header): this source publishes no posting date and no estimate.
      postedDate: null,
      closeDate: dueDay,
      estimatedCloseDate: null,
      // ONLY the source's own Status cell decides these, never the page prose.
      ongoing: /^\s*(rolling|ongoing|year[\s-]?round|continuous|open\s*[-–]\s*rolling)\s*$/i.test(
        statusText,
      ),
      sourceClosed: /^\s*closed\b/i.test(statusText),
      sourceUpdatedAt: null,
      eligibleApplicants: eligibility.length > 0 ? eligibility : NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        portal: "New York State Grant Opportunity Portal (SFS Vendor Portal)",
        portalRowUrl: NEW_YORK_SOURCE_URL,
        listedBy: NEW_YORK_SOURCE_URL,
        gridView: NEW_YORK_GRID_VIEW,
        gridRowsParsed: rows.length,
        gridRowsDeclaredByPortal: declared,
        // The source's own id for this opportunity, and its own agency code.
        eventId,
        fundingAgency: cell("fundingAgency"),
        // The source's own status words, verbatim, and what was read from them.
        portalStatus: statusText,
        portalStatusDeclaresClosed: /^\s*closed\b/i.test(statusText),
        portalStatusDeclaresOngoing: /^\s*(rolling|ongoing|year[\s-]?round|continuous|open\s*[-–]\s*rolling)\s*$/i.test(
          statusText,
        ),
        // Column ownership is structural: these are the source's own header
        // labels, read off the fetched page, and each value came from that column.
        columnLabelsReadFromThePortalsOwnHeader: { ...NEW_YORK_COLUMN_FIELD },
        closeDateColumnLabel: NEW_YORK_READ_COLUMN.dueDate,
        closeDateCellText: dueText.length > 0 ? dueText : null,
        closeDateReadFromTheDueDateColumn: dueDay !== null,
        // A grid row has no static per-opportunity URL (the name cell is a
        // PeopleSoft javascript post-back), so every record links to the
        // official portal page — never to an invented address.
        perOpportunityUrlAvailable: false,
        perOpportunityUrlNote:
          "the portal's Grant Opportunity cell is a PeopleSoft javascript: post-back, not a link, so no static per-opportunity URL exists to publish; each record points at the official portal page it was read from",
        availabilityDateNeverAPostingDate: true,
        anticipatedReleaseDateNeverADeadline: true,
        refusedDates: refused,
        refusedDatesNeverCloseDates: true,
        // The listing is only served inside a PUBLIC, unauthenticated session
        // (owner-approved, in-memory cookies only — see the module header).
        publicSessionOnly: true,
        publicSessionNote:
          "a cookie-less GET of this listing answers 302 with no grid at all; it is read via the portal's own public guest page and the temporary public-session cookies that page sets, in memory for this run only, with no credentials and nothing persisted",
        credentialsNeverSent: true,
        // WHY NEW YORK IS `limited`: one source, even though it is the State's
        // own multi-agency portal — never advertised as statewide coverage.
        oneSourceNeverStatewideCoverage: true,
      },
    });
  }
  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "New York grid carried rows but none was a nameable opportunity — refusing to serve an empty listing",
    );
  }
  return records;
}

/** New York's Grant Opportunity Portal connector (SFS Vendor Portal). */
export const newYorkConnector: StateGrantConnector<string> = {
  id: NEW_YORK_CONNECTOR_ID,
  stateCode: "NY",
  stateName: "New York",
  sourceName: NEW_YORK_SOURCE_NAME,
  agency: NEW_YORK_AGENCY,
  sourceUrl: NEW_YORK_SOURCE_URL,
  officialHost: NEW_YORK_SOURCE_HOST,
  sourceValidationTest: NEW_YORK_SOURCE_VALIDATION_TEST,
  async fetch(): Promise<string> {
    // The portal's own public session page first (a plain anonymous GET), then
    // the listing carrying the temporary public-session cookies that page set.
    // ANY failure — the session page, the handshake cookie, the listing — throws
    // and the run writes nothing: fail closed, exactly as the owner's ruling
    // requires.
    return fetchStateGrantSource({
      url: NEW_YORK_SOURCE_URL,
      marker: NEW_YORK_LISTING_MARKER,
      label: "New York (SFS Grant Opportunity Portal)",
      approvedHosts: NEW_YORK_APPROVED_HOSTS,
      minBytes: NEW_YORK_LISTING_MIN_BYTES,
      publicSession: {
        sessionUrl: NEW_YORK_SESSION_URL,
        sessionMarker: NEW_YORK_SESSION_MARKER,
        sessionMinBytes: NEW_YORK_SESSION_MIN_BYTES,
        requiredCookies: NEW_YORK_REQUIRED_COOKIES,
      },
    });
  },
  parse(raw: string): SourceGrantRecord[] {
    return parseNewYorkGrid(raw);
  },
  classify(record: SourceGrantRecord, now?: Date | number): GrantClassification {
    return classifyStateGrant(record, now);
  },
};
