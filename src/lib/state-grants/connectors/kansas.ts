/**
 * KANSAS CONNECTOR — state grants NATIONWIDE workstream, batch 1
 * (owner nationwide order 2026-09-19; source chosen + verified against the raw
 * capture by the batch-1 design session; fixture saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded):
 *   https://www.kansascommerce.gov/grantscalendar/
 * WHY THIS IS OFFICIAL: it is the **Kansas Department of Commerce**'s own grants
 * calendar on the department's `.gov` domain (the department names itself on the
 * page), it is a server-rendered WordPress TablePress table, it needs no key, and
 * it lists one row per program with the department's own Application Period, Max
 * Amount and Match columns. The bare path redirects to the trailing-slash form
 * (301) — both hosts are approved. The fetched page is the saved fixture the unit
 * tests parse (`fixtures/kansas-grants-calendar.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE department's calendar. Kansas
 * agencies publish funding programs we have NOT validated, so the registry
 * reports Kansas as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch-1 source-verification report):
 *   - The Application Period column publishes MONTH RANGES WITH NO YEAR ("Mar.-Apr.",
 *     "Feb.-Mar.", "Jan.-Oct.", "Oct.-Jan."). A year-less fragment matches nothing
 *     in `publishedDaysIn`/`singlePublishedDay`, so those records carry NO date at
 *     all and classify `unverified`. No year is ever invented, and "Spring 2026"
 *     style wording is never converted into a day.
 *   - "Rolling" in the Application Period column is the SOURCE declaring the
 *     program has no deadline → `rolling` (`declaresOngoing`), with `closeDate`
 *     null. It is never read as a date and never inferred from the Awards Given
 *     column, which also says "Rolling" on some rows.
 *   - The Announcement and Awards Given columns are MONTH LABELS (when a decision
 *     is announced / when awards are handed out). They are NOT application
 *     deadlines: this connector never reads them, and names them in
 *     `raw.ignoredColumns` so a reviewer can see they were deliberately skipped.
 *   - The table publishes no per-program description… except the Description
 *     column, which is used as the summary; it publishes no eligibility or
 *     geography, so those stay `NOT_SPECIFIED`.
 *   - The page publishes NO per-program URL (its only links are Cloudflare-obfuscated
 *     contact addresses), so every record's `url` is the LISTING page
 *     (CONVENTIONS.md §1) and its identity is the slug of the program's own title.
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  slugify,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  StateSourceError,
  declaresOngoing,
  fetchStateGrantSource,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const KANSAS_SOURCE_URL = "https://www.kansascommerce.gov/grantscalendar/";
export const KANSAS_SOURCE_HOST = "www.kansascommerce.gov";
export const KANSAS_APPROVED_HOSTS: readonly string[] = [
  "www.kansascommerce.gov",
  "kansascommerce.gov",
];
export const KANSAS_AGENCY = "Kansas Department of Commerce";
export const KANSAS_SOURCE_NAME = "Kansas Department of Commerce — Grants Calendar";
export const KANSAS_CONNECTOR_ID = "ks-commerce-grants-calendar";
export const KANSAS_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/kansas.source-validation.test.ts";

/** The TablePress table's own class (absent ⇒ this is not the calendar page). */
export const KANSAS_CONTENT_MARKER = 'class="tablepress';

/**
 * The header cell that makes this table the grants CALENDAR we validate. Without
 * it the payload is some other table and is refused (Hawaii-style fail-closed).
 */
export const KANSAS_REQUIRED_HEADER = "Application Period";

/** The only columns this connector reads, by the source's own header wording. */
const TITLE_COLUMN = "Award";
const DESCRIPTION_COLUMN = "Description";
const MAX_AMOUNT_COLUMN = "Max Amount";
const MATCH_COLUMN = "Match";
const APPLICATION_PERIOD_COLUMN = KANSAS_REQUIRED_HEADER;
/**
 * Columns that exist on the row and are deliberately NOT read: both are month
 * labels about the decision/award, never an application deadline.
 */
const IGNORED_COLUMNS: readonly string[] = ["Announcement", "Awards Given", "Contact"];

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1] ?? ""));
}

/** A published money cell ("$ 200,000") → the ceiling it states, or null. */
function moneyCeiling(raw: string): number | null {
  const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const n = Number((m[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parses the Kansas grants calendar into normalised, UNCLASSIFIED records. */
export function parseKansasGrantsCalendar(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(KANSAS_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Kansas source payload is not the expected grants calendar (marker ${JSON.stringify(
        KANSAS_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const tableStart = html.indexOf(KANSAS_CONTENT_MARKER);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd === -1) {
    throw new StateSourceError(
      "parse",
      "Kansas source's grants table was not closed — refusing to parse an unknown region",
    );
  }
  const table = html.slice(tableStart, tableEnd);

  const headerRow = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(table);
  const headers = headerRow ? cellsOf(headerRow[1] ?? "") : [];
  if (!headers.includes(KANSAS_REQUIRED_HEADER)) {
    throw new StateSourceError(
      "parse",
      `Kansas source's table has no ${JSON.stringify(
        KANSAS_REQUIRED_HEADER,
      )} column — the calendar layout changed, refusing to read it as an application period`,
    );
  }
  /** Column index by the source's own header text (never a hard-coded position). */
  const column = (label: string): number => headers.indexOf(label);
  const [titleCol, descCol, amountCol, matchCol, periodCol] = [
    column(TITLE_COLUMN),
    column(DESCRIPTION_COLUMN),
    column(MAX_AMOUNT_COLUMN),
    column(MATCH_COLUMN),
    column(APPLICATION_PERIOD_COLUMN),
  ];

  const bodyStart = table.search(/<tbody[^>]*>/i);
  const body = bodyStart === -1 ? table : table.slice(bodyStart);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = cellsOf(row[1] ?? "");
    const title = (cells[titleCol] ?? "").trim();
    // The calendar's trailing rows are empty spacer rows — skipped, not invented.
    if (title.length < 3) continue;

    const description = (cells[descCol] ?? "").trim();
    const amountText = (cells[amountCol] ?? "").trim();
    const matchText = (cells[matchCol] ?? "").trim();
    // The ONE date-bearing cell. Its values are year-less month ranges, so
    // `singlePublishedDay` returns null by construction — no invented year.
    const periodText = (cells[periodCol] ?? "").trim();
    const rolling = declaresOngoing(periodText);

    records.push({
      sourceKey: KANSAS_CONNECTOR_ID,
      stateCode: "KS",
      externalId: nextId(slugify(title)),
      title,
      agency: KANSAS_AGENCY,
      summary: description.length > 0 ? description : NOT_SPECIFIED,
      url: KANSAS_SOURCE_URL,
      sourceUrl: KANSAS_SOURCE_URL,
      postedDate: null,
      closeDate: rolling ? null : singlePublishedDay(periodText),
      estimatedCloseDate: null,
      ongoing: rolling,
      sourceClosed: false,
      // No per-record stamp on the calendar; the fingerprint detects amendments.
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: amountText.length > 0 ? amountText : NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: amountText.length > 0 ? moneyCeiling(amountText) : null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: matchText.length > 0 ? matchText : NOT_SPECIFIED,
      raw: {
        applicationPeriodText: periodText,
        // The harness's date-text spot check reads this field: it is the source's
        // own application-period wording, whether or not it resolves to a day.
        closingText: periodText,
        rollingDeclaredBySource: rolling,
        datesPublishedBySourceAreYearless: singlePublishedDay(periodText) === null && !rolling,
        maxAmountText: amountText,
        matchText,
        // Proven, PA-style: these columns are on the row and are never read.
        ignoredColumns: [...IGNORED_COLUMNS],
        perRecordUrlPublished: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Kansas source parsed to zero programs — the calendar layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyKansasRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector the registry, the sources registry and the runner use. */
export const kansasConnector: StateGrantConnector<string> = {
  id: KANSAS_CONNECTOR_ID,
  stateCode: "KS",
  stateName: "Kansas",
  sourceName: KANSAS_SOURCE_NAME,
  agency: KANSAS_AGENCY,
  sourceUrl: KANSAS_SOURCE_URL,
  officialHost: KANSAS_SOURCE_HOST,
  sourceValidationTest: KANSAS_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: KANSAS_SOURCE_URL,
      marker: KANSAS_CONTENT_MARKER,
      label: "Kansas",
      // The apex redirects to the canonical host; nothing else may answer.
      approvedHosts: KANSAS_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseKansasGrantsCalendar(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyKansasRecord(record, now);
  },
};
