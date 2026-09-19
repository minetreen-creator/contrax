/**
 * PENNSYLVANIA CONNECTOR — state grants P3, batch #1 (owner rollout order
 * 2026-09-18; batch chosen, live-verified and fixture-saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded):
 *   https://www.pa.gov/agencies/coa/grants-and-loans/due-dates-for-grants
 * WHY THIS IS OFFICIAL: it is the Commonwealth of Pennsylvania's own `.gov`
 * site — the "Due Dates for Grants" page of **Pennsylvania Creative Industries**
 * (the Pennsylvania Council on the Arts' funding body), reached from the
 * agency's Grants and Loans hub. It is server-rendered, needs no key, and its
 * "Due Dates Calendar" table carries one row per program with the source's own
 * application due date ("11/13/2026, by 5 p.m. EST", "Rolling", "TBD").
 * Verified live 2026-09-19 (HTTP 200, 7 program rows); the fetched page is the
 * saved fixture the unit tests parse (`fixtures/pennsylvania-due-dates.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW → the registry reports Pennsylvania as
 * `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch source-verification report — this
 * page needed re-cutting, which this connector does):
 *   - The table has FOUR columns: Program Name, **Application Due Date**,
 *     Grant Activity/Performance Period, and **Final Report Due Date**. Only the
 *     Application Due Date column is ever read. The performance period and the
 *     final-report date are real dates on the row and are deliberately IGNORED:
 *     a final report is not an application deadline, and reading it would put a
 *     false close date on a program.
 *   - Multi-deadline cells ("Quarterly: -- 06/12/2026 -- 09/11/2026 …", and the
 *     two labelled dates on Creative Districts) do NOT resolve to one closing
 *     day: `singlePublishedDay()` returns null and the record stays `unverified`
 *     with the source's text kept in `raw`. A date is never picked for the user.
 *   - "Rolling" in the due-date column is the source declaring the program has no
 *     deadline → `rolling`, close date null.
 *   - "TBD" stays no date at all → `unverified`.
 *   - The page publishes no per-program description, eligibility, geography,
 *     award or match on this table, so those columns are `NOT_SPECIFIED`/empty —
 *     the deadline page is what it is, and nothing is inferred to fill it out.
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
  declaresOngoing,
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
} from "~/lib/state-grants/connectors/source-support";

export const PENNSYLVANIA_SOURCE_URL =
  "https://www.pa.gov/agencies/coa/grants-and-loans/due-dates-for-grants";
export const PENNSYLVANIA_SOURCE_HOST = "www.pa.gov";
export const PENNSYLVANIA_APPROVED_HOSTS: readonly string[] = ["www.pa.gov", "pa.gov"];
export const PENNSYLVANIA_AGENCY = "Pennsylvania Creative Industries";
export const PENNSYLVANIA_SOURCE_NAME =
  "Pennsylvania Creative Industries (PA Council on the Arts) — Due Dates for Grants";
export const PENNSYLVANIA_CONNECTOR_ID = "pa-pci-due-dates";
export const PENNSYLVANIA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/pennsylvania.source-validation.test.ts";

/** The listing's own heading — present only on this page's calendar table. */
export const PENNSYLVANIA_CONTENT_MARKER = "Due Dates Calendar";

/** Index of the columns this connector reads (0-based, source's own order). */
const PROGRAM_COLUMN = 0;
const APPLICATION_DUE_COLUMN = 1;

interface Row {
  title: string;
  href: string | null;
  dueText: string;
}

/** Reads the calendar rows; the header row carries headings, not a link. */
function readRows(region: string): Row[] {
  const rows: Row[] = [];
  for (const m of region.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(m[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1] ?? "");
    if (cells.length <= APPLICATION_DUE_COLUMN) continue;
    const programCell = cells[PROGRAM_COLUMN] ?? "";
    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(programCell);
    if (!link) continue;
    const title = stripTags(link[2] ?? "");
    if (title.length < 3) continue;
    rows.push({
      title,
      href: link[1] ?? null,
      dueText: stripTags(cells[APPLICATION_DUE_COLUMN] ?? ""),
    });
  }
  return rows;
}

/** Parses the Due Dates Calendar into normalised, UNCLASSIFIED records. */
export function parsePennsylvaniaDueDatesPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(PENNSYLVANIA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Pennsylvania source payload is not the expected due-dates page (marker ${JSON.stringify(
        PENNSYLVANIA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const start = html.indexOf(PENNSYLVANIA_CONTENT_MARKER);
  const end = html.indexOf("</table>", start);
  if (end === -1) {
    throw new StateSourceError(
      "parse",
      "Pennsylvania source's due-dates table was not closed — refusing to parse an unknown region",
    );
  }
  const rows = readRows(html.slice(start, end));
  if (rows.length === 0) {
    throw new StateSourceError(
      "parse",
      "Pennsylvania source parsed to zero programs — the table layout changed, refusing to report an empty corpus",
    );
  }

  const records: SourceGrantRecord[] = [];
  for (const row of rows) {
    const url = officialUrl(row.href, {
      baseUrl: PENNSYLVANIA_SOURCE_URL,
      approvedHosts: PENNSYLVANIA_APPROVED_HOSTS,
    });
    const externalId =
      externalIdFromPath(url, ["agencies/coa/current-opportunities/"]) ??
      row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    // ONLY the application due date column: one unambiguous published day, or
    // null (multi-deadline cycle / TBD / year-less).
    const closeDate = singlePublishedDay(row.dueText);
    const ongoing = declaresOngoing(row.dueText);

    records.push({
      sourceKey: PENNSYLVANIA_CONNECTOR_ID,
      stateCode: "PA",
      externalId,
      title: row.title,
      agency: PENNSYLVANIA_AGENCY,
      summary: NOT_SPECIFIED,
      url,
      sourceUrl: PENNSYLVANIA_SOURCE_URL,
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed: false,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        applicationDueDateText: row.dueText,
        rollingDeclaredBySource: ongoing,
        // Recorded for the reviewer: the row carries two further date columns
        // (performance period, final report due date) that are NOT the
        // application deadline and are deliberately not read.
        ignoredColumns: ["Grant Activity/Performance Period", "Final Report Due Date"],
      },
    });
  }
  return records;
}

export function classifyPennsylvaniaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const pennsylvaniaConnector: StateGrantConnector<string> = {
  id: PENNSYLVANIA_CONNECTOR_ID,
  stateCode: "PA",
  stateName: "Pennsylvania",
  sourceName: PENNSYLVANIA_SOURCE_NAME,
  agency: PENNSYLVANIA_AGENCY,
  sourceUrl: PENNSYLVANIA_SOURCE_URL,
  officialHost: PENNSYLVANIA_SOURCE_HOST,
  sourceValidationTest: PENNSYLVANIA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: PENNSYLVANIA_SOURCE_URL,
      marker: PENNSYLVANIA_CONTENT_MARKER,
      label: "Pennsylvania",
    });
  },
  parse(raw: string) {
    return parsePennsylvaniaDueDatesPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyPennsylvaniaRecord(record, now);
  },
};
