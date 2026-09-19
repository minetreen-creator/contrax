/**
 * VERMONT CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR #408; build spec §C, VT).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://accd.vermont.gov/community-development/funding-incentives — the Agency
 *   of Commerce and Community Development's own "Funding and Incentives" listing,
 *   plus the programme pages that listing publishes (a plain HTML Drupal site: no
 *   key, no login, no JavaScript).
 *
 * WHY THIS IS A MULTI-PAGE SOURCE. The listing is a PROGRAM CATALOGUE (Class B in
 * the build spec): it names the programmes and carries no application dates of its
 * own — its handful of date tokens are page furniture (a PDF's year, the 1974
 * CDBG origin, "Designation 2050"). Parsing it could only ever produce
 * all-`unverified` records, which the build spec's rule A.2 says does NOT earn a
 * tier. So the connector fetches the listing plus the programme pages themselves
 * and reads every record from that programme's OWN page(s); no record can inherit
 * a date, a status or a sentence from a sibling programme or from the listing (the
 * District of Columbia NO-GO cause was exactly a date inherited from the wrong
 * block).
 *
 * WHY THE PROGRAMME LIST IS PINNED RATHER THAN SCRAPED. The listing's own links
 * span the WHOLE agency — housing, historic preservation, tourism, translated
 * renter materials, archaeology — and only some of them are grant programmes. A
 * link-derived child list would fan out over the entire site and pick up pages we
 * have not validated. The five programme families below are the ones this
 * connector reads, each named by the agency's own page title; the fan-out is
 * bounded by that list.
 *
 * WHAT THE SOURCE ACTUALLY PUBLISHES (verified live 2026-09-19), and what is
 * therefore refused as a deadline:
 *   - VCDP (CDBG): the programme page's ONLY date is a public-comment deadline on
 *     a draft federal report — "Seeking Comments for FY25 DRAFT CAPER by
 *     September 28, 2026 at 4:30pm". That is a document review, NOT a grant
 *     application deadline, so it is never a close date. The programme's own
 *     applicant-guidance page says in the agency's own words "VCDP accepts
 *     applications on a rolling basis", so the programme is `rolling`
 *     (close_date null). The same page publishes the Community Development Board
 *     submission SCHEDULE as a table whose columns the agency labels itself
 *     ("Pre-App Due", …, "Submission Date for Application", "CD Board Meeting
 *     Schedule"); each ROW of that table is one application cycle, and its value
 *     in the "Submission Date for Application" COLUMN is the cycle's own deadline
 *     — row-scoped and column-labelled, exactly the Indiana precedent. The
 *     board-meeting dates a row also lists are never read as deadlines, and the
 *     agency's "it is recommended that you submit … before the due dates listed
 *     below" wording is kept in `raw`.
 *   - CHIP: "Is there a deadline to submit a CHIP application? No. Applications
 *     will be accepted on a rolling basis until December 31, 2035." → the
 *     source's own rolling statement ⇒ `rolling`, close_date null (the 2035 year
 *     is the end of a rolling acceptance, not a deadline this connector may
 *     expire).
 *   - Downtown Transportation Fund: "The application period for the 2026 Downtown
 *     Transportation Fund grant is now closed." → the source's own past-tense
 *     words ⇒ `closed`. The awardee paragraph on the same page ("In 2025, eight
 *     designated downtowns … received $1,452,405") is an awards list and is never
 *     a deadline.
 *   - TIF: the page's dated lines are a municipal DEBT-INCURRENCE example
 *     timeline — "March 31, 2022: Deadline to incur first debt" / "March 31, 2027:
 *     Deadline to incur all TIF debt if first debt incurred by 3/31/2022" / "2019–
 *     2039: Retention Period". The agency's own words say these bind a
 *     municipality's borrowing, not an application, so they are REFUSED as
 *     deadlines (recorded under `refusedDates`) and the record stays `unverified`
 *     with no close date.
 *   - VEGI: the dated lines are an INCENTIVE/activity period ("For the period of
 *     July 1, 2025 to June 30, 2026, applicants located within all counties except
 *     … are eligible to apply for a labor market area enhancement") — a period in
 *     which an incentive may be earned, never an application deadline, so it is
 *     REFUSED too and the record stays `unverified` with no close date.
 *
 * NARROW BY CONSTRUCTION. This is five programme pages of ONE agency (ACCD) out of
 * a much larger catalogue the agency publishes. Vermont's own /grants page is a
 * 2020 pandemic-recovery ARCHIVE and is never read (an archive is not coverage).
 * So the state is `limited` — never `curated`/`connected`, and the registry note
 * says so.
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
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";

/**
 * The agency's own site root. ACCD publishes its funding programmes across
 * several sections of ONE official site (community development, economic
 * development, historic preservation), so no single listing PATH contains them
 * all — the root is the one page every record's own page sits under. The listing
 * this connector actually reads is `VERMONT_LISTING_URL` (also recorded in every
 * record's `raw.listedBy`).
 */
export const VERMONT_SOURCE_URL = "https://accd.vermont.gov";
/** The agency's own "Funding and Incentives" listing the connector fetches first. */
export const VERMONT_LISTING_URL =
  "https://accd.vermont.gov/community-development/funding-incentives";
export const VERMONT_SOURCE_HOST = "accd.vermont.gov";
export const VERMONT_APPROVED_HOSTS: readonly string[] = [
  "accd.vermont.gov",
  "www.accd.vermont.gov",
];
/** The publishing body, in the page's own words (its own site header). */
export const VERMONT_AGENCY = "Agency of Commerce and Community Development";
export const VERMONT_SOURCE_NAME =
  "Vermont Agency of Commerce and Community Development — Funding and Incentives programme pages";
export const VERMONT_CONNECTOR_ID = "vt-accd-funding-incentives";
export const VERMONT_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/vermont.source-validation.test.ts";

/** The listing's own sentence that introduces its programmes (the corpus marker). */
export const VERMONT_INDEX_MARKER =
  "Each program below serves a particular area of interest and has specific eligibility requirements";
/** Today the connector reads five programme families; more than this fails loudly. */
export const VERMONT_MAX_CHILD_PAGES = 8;

const ACCD = "https://accd.vermont.gov";

export const VERMONT_VCDP_URL = `${ACCD}/community-development/funding-incentives/vcdp`;
export const VERMONT_VCDP_APPLICANT_GUIDANCE_URL = `${ACCD}/community-development/funding-incentives/vcdp/applicant-guidance`;
export const VERMONT_CHIP_URL = `${ACCD}/economic-development/vepc/chip`;
export const VERMONT_DOWNTOWN_TRANSPORTATION_FUND_URL = `${ACCD}/community-development/funding-incentives/downtown-transportation-fund`;
export const VERMONT_TIF_URL = `${ACCD}/economic-development/vepc/tif`;
export const VERMONT_VEGI_URL = `${ACCD}/economic-development/vepc/vegi`;

/** The agency's own label on the schedule column that carries a cycle's deadline. */
export const VERMONT_SUBMISSION_COLUMN_LABEL = "Submission Date for Application";

export interface VermontProgramme {
  /** Stable id seed for every record of this programme. */
  slug: string;
  /** The agency's own name for the programme (used only if a page has no h1). */
  name: string;
  /** The programme's OWN pages, in the order the connector reads them. */
  pageUrls: readonly string[];
  /** The programme's OWN page whose schedule table publishes its cycles, if any. */
  schedulePageUrl: string | null;
}

/**
 * The programme families this connector reads, each with the agency's own page(s).
 * VCDP's rolling statement and its cycle schedule live on the applicant-guidance
 * page the VCDP page itself links, so both VCDP pages belong to that one programme.
 */
export const VERMONT_PROGRAMMES: readonly VermontProgramme[] = [
  {
    slug: "vcdp",
    name: "Vermont Community Development Program",
    pageUrls: [VERMONT_VCDP_URL, VERMONT_VCDP_APPLICANT_GUIDANCE_URL],
    schedulePageUrl: VERMONT_VCDP_APPLICANT_GUIDANCE_URL,
  },
  {
    slug: "chip",
    name: "Community and Housing Infrastructure Program (CHIP)",
    pageUrls: [VERMONT_CHIP_URL],
    schedulePageUrl: null,
  },
  {
    slug: "downtown-transportation-fund",
    name: "Downtown Transportation Fund",
    pageUrls: [VERMONT_DOWNTOWN_TRANSPORTATION_FUND_URL],
    schedulePageUrl: null,
  },
  {
    slug: "tif",
    name: "Tax Increment Financing (TIF)",
    pageUrls: [VERMONT_TIF_URL],
    schedulePageUrl: null,
  },
  {
    slug: "vegi",
    name: "Vermont Employment Growth Incentive (VEGI)",
    pageUrls: [VERMONT_VEGI_URL],
    schedulePageUrl: null,
  },
];

/** Every page the connector fetches, in the connector's own order (bounded). */
export const VERMONT_PROGRAMME_PAGES: readonly string[] = VERMONT_PROGRAMMES.flatMap(
  (programme) => programme.pageUrls,
);

// ── The agency's own content region, and the blocks inside it ────────────────

const H1_RE = /<h1\b[^>]*>/i;
/** How far a content region may run when a page has no closing </article>. */
const CONTENT_REGION_CAP = 60_000;
const BLOCK_SPLIT_RE = /<\/(?:p|li|td|th|h[1-6]|div|tr|table)\s*>/gi;

/**
 * The page's own content region: from its h1 (the agency's own page title) to the
 * end of the article that carries the page's body. Everything before the h1 is
 * site furniture — the shared navigation lists EVERY programme of the agency, so
 * reading it would attribute one programme's words to another.
 */
export function vermontContentRegion(html: string): string | null {
  const h1 = H1_RE.exec(html);
  if (h1 === null) return null;
  const start = h1.index ?? 0;
  const close = html.indexOf("</article>", start);
  const end = close === -1 ? Math.min(html.length, start + CONTENT_REGION_CAP) : close + "</article>".length;
  return html.slice(start, end);
}

/** The agency's own h1 for a page, whitespace-collapsed (never a nav label). */
export function vermontPageTitle(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const text = m ? stripTags(m[1] ?? "").replace(/\s+/g, " ").trim() : "";
  return text.length > 0 ? text : null;
}

/**
 * The page's own content split into the source's own blocks (paragraphs, list
 * items, table cells, headings), stripped of markup. Reading block by block keeps
 * every sentence attributed to the block that published it: a value can never be
 * read out of a neighbouring programme's block.
 */
export function vermontBlocks(html: string): string[] {
  const region = vermontContentRegion(html);
  if (region === null) return [];
  return region
    .split(BLOCK_SPLIT_RE)
    .map((block) => stripTags(block).replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
}

// ── The source's own signals, and the dates it publishes for something else ──

/** The agency's own rolling wording ("accepted/accepts applications on a rolling basis"). */
const ROLLING_RE = /\bon a rolling basis\b/i;
/** The agency's own past-tense wording for a finished cycle. */
const CLOSED_RE = /\bis now closed\b/i;

export type VermontRefusalKind =
  | "public-comment"
  | "recommended-schedule"
  | "debt-incurrence"
  | "retention-period"
  | "incentive-period";

export interface VermontRefusedDate {
  /** The block's own text, verbatim. */
  text: string;
  kind: VermontRefusalKind;
  /** Why this date can never be a close date. */
  reason: string;
}

/** Each refusal rule carries the reason, so `raw` explains itself to a reviewer. */
const REFUSAL_RULES: readonly {
  kind: VermontRefusalKind;
  re: RegExp;
  reason: string;
}[] = [
  {
    kind: "public-comment",
    re: /\bSeeking Comments\b/i,
    reason:
      "the agency publishes this date for COMMENTS on a draft federal report (FY25 DRAFT CAPER), not for applications — a document-review deadline is never an application deadline",
  },
  {
    kind: "recommended-schedule",
    re: /\bit is recommended that you submit\b/i,
    reason:
      "the agency RECOMMENDS submitting before the board-meeting dates listed below for a programme that accepts applications on a rolling basis — a recommendation is never a close date",
  },
  {
    kind: "debt-incurrence",
    re: /\bDeadline to incur\b/i,
    reason:
      "the agency calls this a deadline to INCUR TIF DEBT — a municipal debt-incurrence obligation, not an application deadline",
  },
  {
    kind: "retention-period",
    re: /\bRetention Period\b/i,
    reason:
      "the agency calls this a TIF RETENTION PERIOD — a tax-retention window, not an application deadline",
  },
  {
    kind: "incentive-period",
    re: /\bFor the period of\b/i,
    reason:
      "the agency publishes this as the PERIOD in which an incentive may be earned / an enhancement applies — an activity period, never an application deadline",
  },
];

export interface VermontSignals {
  title: string | null;
  /** The agency's own rolling sentence, when it publishes one. */
  rollingSentence: string | null;
  /** The agency's own past-tense "now closed" sentence, when it publishes one. */
  closedSentence: string | null;
  /** Every dated block the connector refuses to read as a deadline, with why. */
  refusedDates: VermontRefusedDate[];
}

/** Reads a programme's OWN pages into the handful of signals it may act on. */
export function vermontSignals(pageHtml: readonly string[]): VermontSignals {
  const blocks = pageHtml.flatMap((html) => vermontBlocks(html));
  const title = pageHtml.length > 0 ? vermontPageTitle(pageHtml[0]!) : null;
  return {
    title,
    rollingSentence: blocks.find((b) => ROLLING_RE.test(b)) ?? null,
    closedSentence: blocks.find((b) => CLOSED_RE.test(b)) ?? null,
    refusedDates: blocks.flatMap((text) => {
      const rule = REFUSAL_RULES.find((r) => r.re.test(text));
      return rule ? [{ text, kind: rule.kind, reason: rule.reason }] : [];
    }),
  };
}

// ── The programme's own submission schedule (row-scoped, column-labelled) ────

const TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
const H3_BEFORE_RE = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;

export interface VermontSubmissionRound {
  /** The heading the agency publishes above this table, verbatim. */
  tableHeading: string | null;
  /** The label the agency puts on the column the deadline is read from. */
  columnLabel: string;
  /** The deadline cell's own text, verbatim. */
  submissionCellText: string;
  /** The row's own board-meeting cell, verbatim (names the cycle). */
  boardMeetingCellText: string | null;
  /** Every cell of the row, verbatim. */
  rowCells: string[];
  /** The single day that cell resolves to. */
  day: string;
}

function cellsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(new RegExp(CELL_RE.source, "gi"))].map((m) =>
    stripTags(m[1] ?? "").replace(/\s+/g, " ").trim(),
  );
}

/**
 * Every application cycle the agency's own schedule table publishes, read from the
 * row that published it and from the column the agency itself labels "Submission
 * Date for Application". A row whose cell holds several different days yields no
 * record (we never pick one), and the board-meeting, public-hearing and pre-app
 * cells are carried in `raw` and are never deadlines.
 */
export function vermontSubmissionRounds(html: string): VermontSubmissionRound[] {
  const region = vermontContentRegion(html);
  if (region === null) return [];
  const rounds: VermontSubmissionRound[] = [];
  for (const table of region.matchAll(new RegExp(TABLE_RE.source, "gi"))) {
    const tableStart = table.index ?? 0;
    let heading: string | null = null;
    for (const h of region.slice(0, tableStart).matchAll(new RegExp(H3_BEFORE_RE.source, "gi"))) {
      heading = stripTags(h[1] ?? "").replace(/\s+/g, " ").trim() || heading;
    }
    const rows = [...(table[1] ?? "").matchAll(new RegExp(ROW_RE.source, "gi"))].map((m) =>
      cellsOf(m[1] ?? ""),
    );
    const headerIndex = rows.findIndex((cells) =>
      cells.some((c) => c.toLowerCase() === VERMONT_SUBMISSION_COLUMN_LABEL.toLowerCase()),
    );
    if (headerIndex === -1) continue;
    const header = rows[headerIndex]!;
    const column = header.findIndex(
      (c) => c.toLowerCase() === VERMONT_SUBMISSION_COLUMN_LABEL.toLowerCase(),
    );
    for (const cells of rows.slice(headerIndex + 1)) {
      const cell = cells[column];
      if (cell === undefined || cell.length === 0) continue;
      const day = singlePublishedDay(cell);
      if (day === null) continue;
      const last = cells[cells.length - 1];
      rounds.push({
        tableHeading: heading,
        columnLabel: header[column]!,
        submissionCellText: cell,
        boardMeetingCellText: last !== undefined && last.length > 0 ? last : null,
        rowCells: cells,
        day,
      });
    }
  }
  return rounds;
}

// ── Parse ───────────────────────────────────────────────────────────────────

/**
 * Parses the ACCD listing + the programme pages it publishes into UNCLASSIFIED
 * records: ONE per programme family (its own page(s), status/facts read from that
 * programme's own text), plus ONE per application cycle the VCDP schedule table
 * publishes. No record can carry a date the source published for something else.
 */
export function parseVermontProgrammes(payload: string): SourceGrantRecord[] {
  if (typeof payload !== "string" || !payload.includes(VERMONT_INDEX_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Vermont source payload is not the expected ACCD Funding and Incentives corpus (marker ${JSON.stringify(
        VERMONT_INDEX_MARKER,
      )} missing)`,
    );
  }
  const pages = splitSourcePages(payload);
  const htmlByUrl = new Map<string, string>();
  for (const page of pages) {
    if (page.url.length > 0) htmlByUrl.set(page.url, page.html);
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const programme of VERMONT_PROGRAMMES) {
    const missing = programme.pageUrls.filter((url) => !htmlByUrl.has(url));
    if (missing.length > 0) {
      throw new StateSourceError(
        "parse",
        `Vermont payload is missing ${programme.name}'s own page(s) ${missing.join(", ")} — refusing to report a partial corpus`,
      );
    }
    const pageHtml = programme.pageUrls.map((url) => htmlByUrl.get(url)!);
    const signals = vermontSignals(pageHtml);
    const title = signals.title ?? programme.name;
    const programmeUrl = programme.pageUrls[0]!;
    const rolling = signals.rollingSentence !== null;
    const closed = signals.closedSentence !== null;

    records.push({
      sourceKey: VERMONT_CONNECTOR_ID,
      stateCode: "VT",
      externalId: nextId(`${VERMONT_CONNECTOR_ID}:${programme.slug}`),
      title,
      agency: VERMONT_AGENCY,
      summary: NOT_SPECIFIED,
      // The programme's OWN page — never the listing, never a sibling programme.
      url: programmeUrl,
      sourceUrl: VERMONT_SOURCE_URL,
      // The agency publishes no opening date for a programme page.
      postedDate: null,
      // Nothing on a programme page is an application deadline this connector may
      // read: the only dated blocks are refusals (see `refusedDates`).
      closeDate: null,
      estimatedCloseDate: null,
      ongoing: rolling,
      sourceClosed: closed,
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
        programmePageUrl: programmeUrl,
        programmePagesRead: [...programme.pageUrls],
        listedBy: VERMONT_LISTING_URL,
        // Every fact above came from THIS programme's own page(s).
        readOnlyFromThisProgrammesOwnPages: true,
        // The agency's own rolling wording, verbatim, or null.
        rollingDeclaredBySource: rolling,
        rollingSentence: signals.rollingSentence,
        // The agency's own past-tense wording for a finished cycle, or null.
        sourceClosedDeclaredBySource: closed,
        closedSentence: signals.closedSentence,
        closingText: signals.closedSentence,
        // Dated blocks the connector refuses to read as an application deadline.
        refusedDates: signals.refusedDates,
        refusedDatesNeverCloseDates: true,
        // The listing's own date tokens (a PDF's year, the 1974 CDBG origin, the
        // Designation 2050 programme) are furniture and are never read.
        listingDatesNeverRead: true,
      },
    });

    if (programme.schedulePageUrl === null) continue;
    const scheduleHtml = htmlByUrl.get(programme.schedulePageUrl);
    if (scheduleHtml === undefined) continue;
    for (const round of vermontSubmissionRounds(scheduleHtml)) {
      records.push({
        sourceKey: VERMONT_CONNECTOR_ID,
        stateCode: "VT",
        externalId: nextId(`${VERMONT_CONNECTOR_ID}:${programme.slug}-application-round`),
        // The agency names the cycle by its own board-meeting column value.
        title: `${title} — CDBG application round (${round.boardMeetingCellText ?? round.tableHeading ?? "scheduled board meeting"})`,
        agency: VERMONT_AGENCY,
        summary: NOT_SPECIFIED,
        url: programme.schedulePageUrl,
        sourceUrl: VERMONT_SOURCE_URL,
        postedDate: null,
        // The row's own value in the column the agency labels "Submission Date for
        // Application" — a published submission date, never an inference.
        closeDate: round.day,
        estimatedCloseDate: null,
        // The agency's rolling statement belongs to the programme record and is
        // never spread onto a dated cycle of the same programme.
        ongoing: false,
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
          programmePageUrl: programmeUrl,
          listedBy: VERMONT_LISTING_URL,
          schedulePageUrl: programme.schedulePageUrl,
          scheduleTableHeading: round.tableHeading,
          submissionColumnLabel: round.columnLabel,
          submissionCellText: round.submissionCellText,
          // The live gate reads a dated record's own source text from this field.
          closingText: round.submissionCellText,
          boardMeetingCellText: round.boardMeetingCellText,
          rowCells: round.rowCells,
          // The deadline came from THIS row's own labelled cell, not the column
          // beside it and not the row above it.
          datesReadFromOwnRowCell: true,
          boardMeetingAndHearingDatesNeverCloseDates: true,
          programmeAcceptsApplicationsOnARollingBasis: rolling,
          listingDatesNeverRead: true,
        },
      });
    }
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Vermont ACCD programme pages parsed to zero records — the programme pages changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyVermontRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const vermontConnector: StateGrantConnector<string> = {
  id: VERMONT_CONNECTOR_ID,
  stateCode: "VT",
  stateName: "Vermont",
  sourceName: VERMONT_SOURCE_NAME,
  agency: VERMONT_AGENCY,
  sourceUrl: VERMONT_SOURCE_URL,
  officialHost: VERMONT_SOURCE_HOST,
  sourceValidationTest: VERMONT_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantPages({
      indexUrl: VERMONT_LISTING_URL,
      marker: VERMONT_INDEX_MARKER,
      label: "Vermont ACCD Funding and Incentives",
      approvedHosts: VERMONT_APPROVED_HOSTS,
      minBytes: 4000,
      childMinBytes: 1500,
      maxChildren: VERMONT_MAX_CHILD_PAGES,
      // The programme pages this connector reads, pinned above: the listing's own
      // links cover the whole agency, so a link-derived list would fan out over
      // pages this connector has not validated.
      childUrls: () => [...VERMONT_PROGRAMME_PAGES],
    });
  },
  parse(raw: string) {
    return parseVermontProgrammes(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyVermontRecord(record, now);
  },
};
