/**
 * INDIANA CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR #408; build spec §C, IN).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.in.gov/arts/programs-and-services/funding/   — the Indiana Arts
 *   Commission's own funding hub, on in.gov. Server-rendered HTML: no key, no
 *   login, no JavaScript.
 * WHY THIS IS A MULTI-PAGE SOURCE. The hub is a PROGRAM CATALOGUE: 63 KB live,
 * thirteen mentions of "grant", ZERO dates. Parsing it could only ever produce
 * undated records, which the build spec's rule A.2 says does NOT earn a tier. Each
 * programme the hub links has its own page, and each of those pages publishes the
 * cycle dates in a table the Commission labels "… Application Timeline" /
 * "Timeline for FY… Granting Cycle". So this connector fetches the hub plus the
 * funding programme pages the HUB ITSELF publishes (see `childUrls`) and reads
 * every record from its OWN child page — the District of Columbia NO-GO cause was
 * a date inherited from the wrong block, so page attribution is structural here.
 *
 * WHY THE CHILD URLS ARE SCOPED TO `/arts/programs-and-services/funding/<slug>`:
 * the hub also links the Commission's TRAINING pages (`/programs-and-services/
 * training/…`) and a cross-link to the hub's own `/funding/index`. A generic
 * "every link under /arts/" sweep would pull training pages into the corpus. Only
 * the hub's funding programme pages are read.
 *
 * THE PER-CYCLE TABLE, READ CELL BY CELL (this is the honesty core):
 *   <tr><td>Program Opens for Applications</td><td>January 8, 2026</td></tr>
 *   <tr><td>Draft Application Review Deadline for New Applicants</td><td>…</td></tr>
 *   <tr><td>Application Due</td><td>Thursday, March 5, 2026 by 11:59 p.m. ET*</td></tr>
 *   <tr><td>Funding Notification</td><td>By July 1, 2026</td></tr>
 *   <tr><td>Final Grant Report Due</td><td>Thursday, July 15, 2027 …</td></tr>
 * ONE row is the deadline — the row the Commission labels "Application Due". The
 * connector reads the value from the deadline row's OWN cell:
 *   - "DRAFT APPLICATION REVIEW DEADLINE FOR NEW APPLICANTS" IS NOT A DEADLINE. It
 *     is a review step on draft applications (its value sits BEFORE the deadline
 *     row and is never read as one) — for the FY2027 spring cycle it is
 *     23 February 2026, eleven days before the cycle closes.
 *   - "FUNDING NOTIFICATION", "FINAL GRANT REPORT DUE", "PANEL REVIEW" AND THE
 *     WEBINAR ROWS ARE PROCESS DATES, never deadlines. Their values are kept in
 *     `raw` (so a reviewer sees them) and never promoted.
 *   - "GRANT PERIOD JULY 1, 2026 – JUNE 30, 2027" IS AN ACTIVITY PERIOD, never a
 *     deadline. It lives in the cycle heading, outside every cell, and the
 *     connector reads dates only from labelled values — the period is carried
 *     verbatim in `raw.grantPeriodText` for the record and is never a date input.
 *   - A STRUCK-THROUGH (<del>) VALUE IS THE COMMISSION'S OWN SUPERSEDED VALUE. The
 *     FY2026 fall cycle row publishes both the original deadline (struck through:
 *     "September 9, 2025") and its replacement ("September 30, 2025") in the same
 *     cell. The source's own markup says which one is in force, so deleted markup
 *     is dropped BEFORE the value is read — this is the source's semantics, not
 *     our pick. (When a cell holds TWO live days and the source does NOT mark one
 *     superseded, nothing is chosen: `singlePublishedDay` returns null and the
 *     cycle is served `unverified`.)
 *   - A PAST CYCLE IS `closed` EVEN THOUGH THE PAGE IS LIVE. Indiana publishes the
 *     current fiscal-year timeline and the previous one; the previous year's cycles
 *     are real published cycles whose dates have passed, so they are served closed,
 *     never dropped and never shown as open.
 *   - NARROW BY CONSTRUCTION. This is ONE agency's (Indiana Arts Commission)
 *     funding programmes. Indiana awards other grants through other agencies we
 *     have NOT validated, so the state is `limited` — never `curated`/`connected`,
 *     and the registry note says this is not statewide coverage.
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
  decodeEntities,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";

export const INDIANA_SOURCE_URL = "https://www.in.gov/arts/programs-and-services/funding/";
export const INDIANA_SOURCE_HOST = "www.in.gov";
export const INDIANA_APPROVED_HOSTS: readonly string[] = ["in.gov", "www.in.gov"];
/** The publishing body, in the page's own words (asserted against the live text). */
export const INDIANA_AGENCY = "Indiana Arts Commission";
export const INDIANA_SOURCE_NAME = "Indiana Arts Commission — Funding Programs";
export const INDIANA_CONNECTOR_ID = "in-arts-commission-funding";
export const INDIANA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/indiana.source-validation.test.ts";

/** The Commission's own label for the one row in a timeline that IS a deadline. */
export const INDIANA_CONTENT_MARKER = "Program Opens for Applications";
/** The hub's own name for its Arts Project Support page (the index's content marker). */
export const INDIANA_INDEX_MARKER = "Arts Project Support";
/** Only the hub's FUNDING programme pages are read — never its training pages. */
export const INDIANA_FUNDING_PATH_PREFIX = "/arts/programs-and-services/funding/";
/** The hub publishes four funding programmes today; more than this fails loudly. */
export const INDIANA_MAX_CHILD_PAGES = 12;

// ── The hub's own list of funding programmes ────────────────────────────────

/** One funding programme the hub links: the page URL and the hub's own name for it. */
export interface IndianaFundingProgram {
  /** Absolute URL on the approved host (normalised to www.in.gov). */
  url: string;
  /** The hub's own link text for the programme, e.g. "Arts Project Support". */
  name: string;
  /** The page's slug inside the funding path, e.g. "arts-project-support". */
  slug: string;
}

const ANCHOR_RE = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Every FUNDING programme page the hub publishes, in the hub's own document
 * order. The first anchor for a URL wins (the hub's listing region names the
 * programme; its later "Learn more about …" buttons do not), and a link that
 * leaves the funding path prefix, the approved hosts, or is the path's own
 * `index` is not a programme page.
 */
export function indianaFundingPrograms(indexHtml: string): IndianaFundingProgram[] {
  const out: IndianaFundingProgram[] = [];
  const seen = new Set<string>();
  for (const m of indexHtml.matchAll(new RegExp(ANCHOR_RE.source, "gi"))) {
    const href = decodeEntities(m[1] ?? "").trim();
    const name = stripTags(m[2] ?? "");
    if (href.length === 0 || name.length === 0) continue;
    let url: URL;
    try {
      url = new URL(href, INDIANA_SOURCE_URL);
    } catch {
      continue;
    }
    if (!INDIANA_APPROVED_HOSTS.includes(url.host)) continue;
    if (!url.pathname.startsWith(INDIANA_FUNDING_PATH_PREFIX)) continue;
    const slug = url.pathname
      .slice(INDIANA_FUNDING_PATH_PREFIX.length)
      .replace(/^\/+|\/+$/g, "");
    if (slug.length === 0 || slug === "index" || slug.includes("/")) continue;
    // Normalise the bare host onto the approved canonical host.
    if (url.host === "in.gov") url.host = "www.in.gov";
    url.hash = "";
    url.search = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, name, slug });
  }
  return out;
}

// ── The per-cycle timeline tables ───────────────────────────────────────────

/** Markup the source uses to strike a superseded value out (never read). */
const DELETED_MARKUP_RE = /<(?:del|s|strike)\b[^>]*>[\s\S]*?<\/(?:del|s|strike)>/gi;
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
/** A cycle heading: an h1–h6, or a bolded standalone paragraph. */
const HEADING_RE =
  /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>|<p\b[^>]*>\s*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*<\/p>/gi;
/** Which headings delimit a cycle (a webinar blurb is not a cycle heading). */
const CYCLE_HEADING_RE = /(?:application timeline|granting cycle|application cycle)/i;
/** A "Spring/Fall Application Cycle" heading names a season, not a fiscal year. */
const SEASON_CYCLE_RE = /\b(Spring|Fall)\s+Application\s+Cycle\b/i;
/** The activity period a cycle heading carries — never a deadline. */
const GRANT_PERIOD_RE = /Grant Period\s*([^)<]*)/i;

const OPENING_LABEL_RE = /^Program Opens for Applications\.?$/i;
const DUE_LABEL_RE = /^Application Due\.?$/i;
const DRAFT_REVIEW_LABEL_RE = /^Draft Application Review Deadline for New Applicants\.?$/i;
const FUNDING_NOTIFICATION_LABEL_RE = /^Funding Notification\.?$/i;
const FINAL_REPORT_LABEL_RE = /Final Grant Report Due\.?$/i;

interface TimelineHeading {
  index: number;
  text: string;
}

interface TimelineRow {
  /** The label cell, in the source's own words. */
  label: string;
  /** The value cell(s) with the source's struck-through text removed. */
  value: string;
  /** Index of the governing cycle heading, or -1 when the page publishes none. */
  headingIndex: number;
}

function cycleHeadings(html: string): TimelineHeading[] {
  const out: TimelineHeading[] = [];
  for (const m of html.matchAll(new RegExp(HEADING_RE.source, "gi"))) {
    const text = stripTags(m[1] ?? m[2] ?? "");
    if (text.length === 0 || !CYCLE_HEADING_RE.test(text)) continue;
    out.push({ index: m.index ?? 0, text });
  }
  return out;
}

function timelineRows(html: string, headings: readonly TimelineHeading[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const m of html.matchAll(new RegExp(ROW_RE.source, "gi"))) {
    const at = m.index ?? 0;
    const cells = [...(m[1] ?? "").matchAll(new RegExp(CELL_RE.source, "gi"))].map(
      (cell) => cell[1] ?? "",
    );
    if (cells.length < 2) continue;
    const label = stripTags(cells[0] ?? "");
    if (label.length === 0) continue;
    // Struck-through markup is dropped BEFORE the value is read: it is the
    // source's own way of saying a value is superseded.
    const value = stripTags(
      cells
        .slice(1)
        .join(" ")
        .replace(DELETED_MARKUP_RE, " "),
    );
    let headingIndex = -1;
    for (const heading of headings) {
      if (heading.index <= at) headingIndex = heading.index;
      else break;
    }
    rows.push({ label, value, headingIndex });
  }
  return rows;
}

/** The page title the Commission publishes for the programme (its own h1). */
function indianaPageTitle(html: string): string | null {
  const m = /<h1\b[^>]*subpage-main-title[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const text = m ? stripTags(m[1] ?? "") : "";
  return text.length > 0 ? text : null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** The stable id fragment a cycle takes from the source's own headings. */
function cycleDiscriminator(season: string | null, timelineHeading: string | null): string | null {
  const fiscalYear = timelineHeading === null ? null : /FY\s*(\d{4})/i.exec(timelineHeading)?.[1];
  if (season !== null && fiscalYear !== undefined && fiscalYear !== null) {
    return `fy${fiscalYear}-${season.toLowerCase()}`;
  }
  if (season !== null) return season.toLowerCase();
  if (timelineHeading !== null) return slugify(timelineHeading);
  return null;
}

/**
 * Parses the hub + programme pages into UNCLASSIFIED records — one per published
 * application cycle, every date taken from that cycle's OWN timeline table.
 */
export function parseIndianaFundingPage(payload: string): SourceGrantRecord[] {
  if (typeof payload !== "string" || !payload.includes(INDIANA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Indiana source payload is not the expected Indiana Arts Commission funding corpus (marker ${JSON.stringify(
        INDIANA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const pages = splitSourcePages(payload);
  const indexPage =
    pages.find((p) => p.url === INDIANA_SOURCE_URL) ??
    pages.find((p) => indianaFundingPrograms(p.html).length > 0);
  const programs = indexPage ? indianaFundingPrograms(indexPage.html) : [];
  const nameByUrl = new Map(programs.map((p) => [p.url, p.name] as const));
  const slugByUrl = new Map(programs.map((p) => [p.url, p.slug] as const));
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const page of pages) {
    // The hub itself publishes no dated listing, and a page we cannot attribute
    // to a URL is not part of this corpus.
    if (page.url.length === 0 || page.url === INDIANA_SOURCE_URL) continue;
    const headings = cycleHeadings(page.html);
    const rows = timelineRows(page.html, headings);
    if (rows.length === 0) continue;
    const programName =
      nameByUrl.get(page.url) ?? indianaPageTitle(page.html) ?? slugByUrl.get(page.url) ?? null;
    if (programName === null) continue;
    const slug = slugByUrl.get(page.url) ?? slugify(programName);

    // Rows are grouped into the runs that share one governing heading — a group
    // is one cycle's own table, so a value can never come from a sibling cycle.
    let groupStart = 0;
    while (groupStart < rows.length) {
      const headingIndex = rows[groupStart]!.headingIndex;
      let groupEnd = groupStart;
      while (groupEnd < rows.length && rows[groupEnd]!.headingIndex === headingIndex) groupEnd += 1;
      const group = rows.slice(groupStart, groupEnd);
      groupStart = groupEnd;

      const dueRow = group.find((r) => DUE_LABEL_RE.test(r.label)) ?? null;
      if (dueRow === null) continue; // a table with no deadline row is not a cycle
      const openRow = group.find((r) => OPENING_LABEL_RE.test(r.label)) ?? null;
      const heading =
        headingIndex === -1 ? null : (headings.find((h) => h.index === headingIndex)?.text ?? null);
      const season = heading === null ? null : (SEASON_CYCLE_RE.exec(heading)?.[1] ?? null);
      const timelineHeading =
        heading !== null && !SEASON_CYCLE_RE.test(heading)
          ? heading
          : // the fiscal-year heading the season cycle sits under
            (headings
              .filter((h) => h.index < (headingIndex === -1 ? 0 : headingIndex) && !SEASON_CYCLE_RE.test(h.text))
              .map((h) => h.text)
              .pop() ?? null);
      const discriminator = cycleDiscriminator(season, timelineHeading);
      const fiscalYear = timelineHeading === null ? null : /FY\s*(\d{4})/i.exec(timelineHeading)?.[1];
      const grantPeriod = heading === null ? null : (GRANT_PERIOD_RE.exec(heading)?.[1]?.trim() ?? null);
      const openDay = openRow === null ? null : singlePublishedDay(openRow.value);
      const dueDay = singlePublishedDay(dueRow.value);
      const idBase = [slug, discriminator].filter((v): v is string => v !== null).join("-");
      const label =
        season !== null
          ? `${fiscalYear === undefined || fiscalYear === null ? "" : `FY${fiscalYear} `}${season} Application Cycle`.trim()
          : (timelineHeading ?? programName);

      records.push({
        sourceKey: INDIANA_CONNECTOR_ID,
        stateCode: "IN",
        externalId: nextId(idBase),
        // The title OPENS with the Commission's own heading for the cycle (so a
        // reader sees the source's words first) and names the programme after it.
        title: heading === null ? programName : `${heading} — ${programName}`,
        agency: INDIANA_AGENCY,
        summary: NOT_SPECIFIED,
        // The page that published this cycle — never the hub, never a sibling.
        url: page.url,
        sourceUrl: INDIANA_SOURCE_URL,
        postedDate: openDay,
        closeDate: dueDay,
        estimatedCloseDate: null,
        // The Commission publishes no "rolling"/year-round wording for a cycle.
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
          childPageUrl: page.url,
          programName,
          cycleHeading: heading,
          timelineHeading,
          cycleLabel: label,
          season,
          fiscalYear,
          // The one row that is a deadline, and its value verbatim.
          applicationDueDateText: dueRow.value,
          closingText: dueRow.value,
          deadlineValue: dueRow.value,
          applicationDeadline: dueRow.value,
          closingDayPublishedBySource: dueDay,
          // The row that publishes the opening day, and its value verbatim.
          openingText: openRow?.value ?? null,
          openingDayPublishedBySource: openDay,
          // Process rows, kept for review and NEVER used as a deadline.
          draftReviewDeadlineText:
            group.find((r) => DRAFT_REVIEW_LABEL_RE.test(r.label))?.value ?? null,
          fundingNotificationText:
            group.find((r) => FUNDING_NOTIFICATION_LABEL_RE.test(r.label))?.value ?? null,
          finalGrantReportText: group.find((r) => FINAL_REPORT_LABEL_RE.test(r.label))?.value ?? null,
          draftReviewDeadlineIsNeverADeadline: true,
          fundingNotificationIsNeverADeadline: true,
          finalGrantReportIsNeverADeadline: true,
          // The activity period carried by the heading, never a deadline.
          grantPeriodText: grantPeriod,
          grantPeriodIsNeverADeadline: true,
          struckThroughValuesAreSupersededBySource: true,
          datesReadOnlyFromThisCyclesOwnCells: true,
          pagePublishesOtherHistoricalCyclesNotHidden: true,
          rollingDeclaredBySource: false,
          sourceClosedDeclaredBySource: false,
        },
      });
    }
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Indiana Arts Commission funding pages parsed to zero application cycles — the timelines changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyIndianaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const indianaConnector: StateGrantConnector<string> = {
  id: INDIANA_CONNECTOR_ID,
  stateCode: "IN",
  stateName: "Indiana",
  sourceName: INDIANA_SOURCE_NAME,
  agency: INDIANA_AGENCY,
  sourceUrl: INDIANA_SOURCE_URL,
  officialHost: INDIANA_SOURCE_HOST,
  sourceValidationTest: INDIANA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantPages({
      indexUrl: INDIANA_SOURCE_URL,
      marker: INDIANA_INDEX_MARKER,
      childMarker: INDIANA_AGENCY,
      label: "Indiana Arts Commission funding",
      approvedHosts: INDIANA_APPROVED_HOSTS,
      minBytes: 4000,
      childMinBytes: 4000,
      maxChildren: INDIANA_MAX_CHILD_PAGES,
      childUrls: (indexHtml) => indianaFundingPrograms(indexHtml).map((p) => p.url),
    });
  },
  parse(raw: string) {
    return parseIndianaFundingPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyIndianaRecord(record, now);
  },
};
