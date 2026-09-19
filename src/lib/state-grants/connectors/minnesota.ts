/**
 * MINNESOTA CONNECTOR — state grants NATIONWIDE workstream, batch 2
 * (owner nationwide order 2026-09-19; source chosen from the phase-1 discovery
 * report row MN and re-verified against the raw capture by the batch-2 design
 * session; fixture cut from the 2026-09-19 capture).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.arts.state.mn.us/calendar/index.htm
 * WHY THIS IS OFFICIAL: it is the **Minnesota State Arts Board**'s own "Arts
 * Board Calendar" page — the state arts agency — on the agency's own domain,
 * server-rendered, no key, HTTP 200 at capture (115 303 B). Its "Grant Program
 * Activity Dates" section publishes, per program, the source's own **Application
 * Deadline** date. The captured page is the saved fixture the unit tests parse
 * (`fixtures/minnesota-arts-board-calendar.html`).
 *
 * THE CANDIDATE THAT WAS REJECTED (documented, never re-proposed):
 *   - https://www.arts.state.mn.us/ (the Arts Board root) — a NEWS/RESOURCES
 *     page: its "Upcoming Opportunities" are a contract RFP and a volunteer
 *     advisor call, NOT grant programs, and it publishes no grant deadline. The
 *     `/grants/` DIRECTORY does not serve a listing (404/403), while
 *     `/calendar/index.htm` and the individual `/grants/<program>.htm` pages do.
 *     Also rejected: mn.gov DEED/MMB (a bot-captcha wall) — not a source.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's calendar. Minnesota
 * publishes funding through other agencies we have NOT validated, so the registry
 * reports Minnesota as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (the Pennsylvania "read only the due-date column"
 * rule, applied to a calendar of cycles)
 *   - The page carries TWO tables: the **current** cycle (FY 2027) and, below it,
 *     the PRIOR cycle (FY 2026) — an expired-cycle archive whose rows duplicate
 *     the current programs. ONLY the first (current-cycle) table is read; the
 *     archive's dates can never become records, and its duplicate ids can never
 *     collide with the current ones.
 *   - Each row has FOUR columns: Grant Program, **Application Deadline**, Board
 *     Approval and Grant Period. ONLY the Application Deadline column is read. A
 *     board-approval month or a grant-period month is not an application deadline,
 *     and reading one would put a false close date on a program.
 *   - A year-less cell ("October 2026") can never become a date: `parseStateDay`
 *     refuses fragments without a day number, and the deadline column always
 *     publishes a full date here, so nothing is invented and nothing is guessed.
 *   - The parse FAILS CLOSED if the current-cycle heading or the
 *     "Application Deadline" header is missing, rather than reporting an empty or
 *     half-read corpus.
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
  contentRegion,
  declaresOngoing,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const MINNESOTA_SOURCE_URL = "https://www.arts.state.mn.us/calendar/index.htm";
export const MINNESOTA_SOURCE_HOST = "www.arts.state.mn.us";
export const MINNESOTA_APPROVED_HOSTS: readonly string[] = [
  "www.arts.state.mn.us",
  "arts.state.mn.us",
];
export const MINNESOTA_AGENCY = "Minnesota State Arts Board";
export const MINNESOTA_SOURCE_NAME =
  "Minnesota State Arts Board — Arts Board Calendar (Grant Program Activity Dates)";
export const MINNESOTA_CONNECTOR_ID = "mn-arts-board-calendar";
export const MINNESOTA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/minnesota.source-validation.test.ts";

/** The listing's own heading — present only on the calendar's activity section. */
export const MINNESOTA_CONTENT_MARKER = "Grant Program Activity Dates";

/** The activity section's own container (the region start). */
export const MINNESOTA_REGION_START = '<div id="activity">';
export const MINNESOTA_REGION_END_MARKERS: readonly string[] = ['id="notification"'];

/** The header the deadline column must carry, or the parse fails closed. */
const DEADLINE_COLUMN = "Application Deadline";

/** 0-based column indexes this connector reads (the source's own order). */
const PROGRAM_COLUMN = 0;
const DEADLINE_COLUMN_INDEX = 1;

interface Row {
  title: string;
  href: string | null;
  deadlineText: string;
}

/** The current-cycle table only: the FIRST `caltab` table after the heading. */
function currentCycleTable(region: string): { start: number; end: number } {
  const table = /<table[^>]*class="caltab"[^>]*>/i.exec(region);
  if (!table) {
    throw new StateSourceError(
      "parse",
      "Minnesota source no longer publishes its grant-activity table — refusing to report an empty corpus",
    );
  }
  const end = region.indexOf("</table>", table.index);
  if (end === -1) {
    throw new StateSourceError(
      "parse",
      "Minnesota source's grant-activity table was not closed — refusing to parse an unknown region",
    );
  }
  return { start: table.index, end };
}

/** The source's own heading for the current cycle, e.g. "FY 2027 Grant Cycle". */
function cycleLabelAbove(region: string, tableStart: number): string | null {
  const headings = [...region.slice(0, tableStart).matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const last = headings[headings.length - 1];
  return last ? stripTags(last[1] ?? "") : null;
}

/** Reads the current-cycle rows; the header row carries headings, not a link. */
function readRows(table: string): Row[] {
  const rows: Row[] = [];
  for (const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(m[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (c) => c[1] ?? "",
    );
    if (cells.length <= DEADLINE_COLUMN_INDEX) continue;
    const programCell = cells[PROGRAM_COLUMN] ?? "";
    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(programCell);
    if (!link) continue;
    const title = stripTags(link[2] ?? "");
    if (title.length < 3) continue;
    rows.push({
      title,
      href: link[1] ?? null,
      deadlineText: stripTags(cells[DEADLINE_COLUMN_INDEX] ?? ""),
    });
  }
  return rows;
}

/** Parses the Arts Board Calendar into normalised, UNCLASSIFIED records. */
export function parseMinnesotaCalendarPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(MINNESOTA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Minnesota source payload is not the expected calendar page (marker ${JSON.stringify(
        MINNESOTA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  if (!html.includes(MINNESOTA_REGION_START)) {
    throw new StateSourceError(
      "parse",
      "Minnesota source no longer publishes the grant-activity section — refusing to parse the whole document",
    );
  }
  const region = contentRegion(html, MINNESOTA_REGION_START, MINNESOTA_REGION_END_MARKERS);
  const { start, end } = currentCycleTable(region);
  const cycleLabel = cycleLabelAbove(region, start);
  if (cycleLabel === null || !/\b\d{4}\b/.test(cycleLabel)) {
    throw new StateSourceError(
      "parse",
      "Minnesota source's current grant cycle heading is missing — refusing to guess which table is current",
    );
  }
  const table = region.slice(start, end);
  if (!table.includes(DEADLINE_COLUMN)) {
    throw new StateSourceError(
      "parse",
      `Minnesota source's grant-activity table no longer has its "${DEADLINE_COLUMN}" column — refusing to parse (the other columns are not deadlines)`,
    );
  }
  const rows = readRows(table);
  if (rows.length === 0) {
    throw new StateSourceError(
      "parse",
      "Minnesota source parsed to zero programs — the table layout changed, refusing to report an empty corpus",
    );
  }

  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];
  for (const row of rows) {
    const url = officialUrl(row.href, {
      baseUrl: MINNESOTA_SOURCE_URL,
      approvedHosts: MINNESOTA_APPROVED_HOSTS,
      canonicalHost: MINNESOTA_SOURCE_HOST,
    });
    records.push({
      sourceKey: MINNESOTA_CONNECTOR_ID,
      stateCode: "MN",
      externalId: nextId(slugify(row.title)),
      title: row.title,
      agency: MINNESOTA_AGENCY,
      summary: NOT_SPECIFIED,
      url,
      sourceUrl: MINNESOTA_SOURCE_URL,
      postedDate: null,
      // ONLY the Application Deadline column: one unambiguous published day, or
      // null (never a board-approval or grant-period month).
      closeDate: singlePublishedDay(row.deadlineText),
      estimatedCloseDate: null,
      ongoing: declaresOngoing(row.deadlineText),
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
        calendarCycle: cycleLabel,
        applicationDeadlineText: row.deadlineText,
        closingText: row.deadlineText,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
        // Recorded for the reviewer: the row carries two further columns that are
        // NOT the application deadline and are deliberately not read.
        ignoredColumns: ["Board Approval", "Grant Period (*)"],
      },
    });
  }
  return records;
}

export function classifyMinnesotaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const minnesotaConnector: StateGrantConnector<string> = {
  id: MINNESOTA_CONNECTOR_ID,
  stateCode: "MN",
  stateName: "Minnesota",
  sourceName: MINNESOTA_SOURCE_NAME,
  agency: MINNESOTA_AGENCY,
  sourceUrl: MINNESOTA_SOURCE_URL,
  officialHost: MINNESOTA_SOURCE_HOST,
  sourceValidationTest: MINNESOTA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: MINNESOTA_SOURCE_URL,
      marker: MINNESOTA_CONTENT_MARKER,
      label: "Minnesota",
      approvedHosts: MINNESOTA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseMinnesotaCalendarPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyMinnesotaRecord(record, now);
  },
};
