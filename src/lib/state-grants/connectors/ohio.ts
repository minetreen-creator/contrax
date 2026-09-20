/**
 * OHIO CONNECTOR — state grants NATIONWIDE workstream (owner 2026-09-20). The
 * source determination, the file list, the pinned list and the exact parse rules
 * are the engineer's own build-ready handoff
 * (`state-grants-oh-ny-attempt-2026-09-20.md` §1.3), and the LEAD DECISION
 * recorded there accepted the Ohio Arts Council catalogue as Ohio's `limited`
 * connector. Raw captures fetched 2026-09-20 to /opt/t12/oh/cap/prog/*.body and
 * trimmed into `fixtures/oh-*.html` (content region, verbatim).
 *
 * OFFICIAL SOURCE (hard-coded):
 *   https://oac.ohio.gov/grants/10-grant-opportunities   (the catalogue)
 * WHY THIS IS OFFICIAL: it is the **Ohio Arts Council**'s own grant-program
 * catalogue on the Council's own `oac.ohio.gov` host, it names the Council on
 * every page, needs no key, and every page in the pinned list below is reachable
 * from it. The catalogue's own link order (captured) is the pinned order.
 *
 * WHY THE PROGRAMME PAGES ARE PINNED RATHER THAN LINK-DERIVED. The catalogue
 * index also links its own portal shell (`/wps/portal/…/!ut/p/z1/…`), the OAC
 * grants calendar, the ARTIE login and the news pages. The 14 pages below are the
 * catalogue's own grant programmes; pinning them bounds the fan-out, so this
 * connector can never widen what it reads on its own.
 *
 * WHY THE STATEWIDE PORTAL IS NOT THIS CONNECTOR'S SOURCE (verified live
 * 2026-09-20, and the reason Ohio is `limited` rather than statewide). Ohio's
 * statewide "Funding Opportunities" listing IS published as JSON by the official
 * OBM API host `https://api.obm.ohio.gov/grants/getfundingopportunities/0/0/1`
 * (155,738 bytes, 9 current records, discovered in grants.ohio.gov's own inline
 * JS) — but that host presents an **incomplete TLS chain**: it sends its leaf
 * certificate only, so verification fails with "unable to get local issuer
 * certificate" in curl, bun and node (openssl verify code 21; the AIA extension
 * advertises the missing intermediate, which is why browsers recover). Only
 * `curl -k` reads it. Disabling verification or pinning a chain is not something
 * this workstream does — there is no honest, verified-TLS route to that endpoint
 * from here — so Ohio is served by ONE agency's catalogue and the state stays
 * `limited`, never `curated`/`connected`, and never "statewide coverage".
 *
 * WHAT THIS SOURCE PUBLISHES AND WHAT IS READ FROM IT. Each pinned programme page
 * carries a labelled lifecycle list (`<li>Label: value</li>`, grouped by cycle
 * headings), which is a PROGRAMME CATALOGUE TIMELINE, not a live notice board:
 * most rows are past cycles. This connector reads EXACTLY ONE thing off those
 * rows — a row whose label is the source's own `Application Deadline …` and whose
 * value is a full published day ("Application Deadline 5 p.m.: November 1, 2026",
 * "Application Deadline at 5 p.m.: February 1, 2025"). The record's close date is
 * the LATEST such row the page publishes (the source's own cycle currently going
 * forward), never a rolled-forward or interpolated date; every EARLIER
 * application-deadline row is kept verbatim in `raw` beside the chosen one. The
 * read is done on the STRIPPED text of each row — several pages wrap the label in
 * `<strong>`, so a raw-HTML read silently misses rows — and it is NOT scoped by an
 * `<h2>TIMELINE</h2>` heading, because only ONE of the 14 pages has that heading
 * while the rest use `<h2 dir="ltr">` or a prose intro.
 *
 * EVERY OTHER DATE ON A PAGE IS REFUSED VERBATIM into `raw.refusedDates` with a
 * reason, so a reviewer can re-derive why it was never published as a deadline:
 * `*Grant Agreement Deadline`, `*Final Report Deadline`, `Off-year Update
 * Deadline`, `Application Available in ARTIE` (a window OPENING, not a closing),
 * `Grant Award Announcement`, `Large Orgs' Financial Materials Due`, the ADAP
 * page's `January 1, 2009` enactment date, the site's own news dates in the
 * furniture around the body, and every date-like token in the page's prose.
 * `raw.refusedDatesNeverCloseDates` is true by construction.
 *
 * NO posted date is read (an `Application Available in ARTIE` row cannot be
 * attributed to one cycle without a per-cycle DOM walk, so `openDate` stays null —
 * same honesty rule as the Arkansas/Kansas/Rhode Island footing) and NO estimate
 * is ever produced. Statuses come from the shared classifier unchanged: a future
 * published deadline ⇒ `open`, a past one ⇒ `closed`, no labelled application
 * deadline at all ⇒ `unverified`.
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  parseStateDay,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  StateSourceError,
  contentRegion,
  externalIdFromPath,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import {
  fetchStateGrantPages,
  splitSourcePages,
} from "~/lib/state-grants/connectors/multi-page";

/** The catalogue the connector fetches FIRST (the listing it names as `listedBy`). */
export const OHIO_SOURCE_URL = "https://oac.ohio.gov/grants/10-grant-opportunities";
export const OHIO_SOURCE_HOST = "oac.ohio.gov";
export const OHIO_APPROVED_HOSTS: readonly string[] = ["oac.ohio.gov", "www.oac.ohio.gov"];
/** The publishing body, in the pages' own words. */
export const OHIO_AGENCY = "Ohio Arts Council";
export const OHIO_SOURCE_NAME =
  "Ohio Arts Council — Grant program catalogue and program pages";
export const OHIO_CONNECTOR_ID = "oh-arts-council-grant-programs";
export const OHIO_SOURCE_VALIDATION_TEST = "src/lib/state-grants/ohio.source-validation.test.ts";

/**
 * A string ONLY the catalogue index carries (its own "Find a Grant Program"
 * call to action): the fail-closed marker the index fetch checks.
 */
export const OHIO_INDEX_MARKER = "Find a Grant Program";
/**
 * The body region every page on this site publishes (index and programme pages
 * alike): the Ohio Design Content region. Present on all 15 captured pages; the
 * region ends at the site's own footer furniture.
 */
export const OHIO_CONTENT_MARKER = "odx-content__title";
/** The site's own markers for the region AFTER the body (never read). */
export const OHIO_BODY_END_MARKERS: readonly string[] = ["<footer", "Powered by"];

/**
 * The programme pages this connector reads, PINNED (never link-derived), in the
 * catalogue's OWN link order (captured 2026-09-20). The index also links its
 * portal shell, the grants calendar, the ARTIE login and the news pages: none of
 * those is a grant-programme page.
 */
export const OHIO_PROGRAMME_PATHS: readonly string[] = [
  "/grants/10-grant-opportunities/01-sustainability",
  "/grants/10-grant-opportunities/65-statewide-arts-service-organizations",
  "/grants/10-grant-opportunities/10-artstart",
  "/grants/10-grant-opportunities/15-artsnext",
  "/grants/10-grant-opportunities/35-artsrise",
  "/grants/10-grant-opportunities/45-capacity-building",
  "/grants/10-grant-opportunities/70-ohio-artists-on-tour",
  "/grants/10-grant-opportunities/20-arts-partnership",
  "/grants/10-grant-opportunities/25-teachartsohio",
  "/grants/10-grant-opportunities/55-big-yellow-school-bus",
  "/grants/10-grant-opportunities/05-individual-excellence-awards",
  "/grants/10-grant-opportunities/40-artists-with-disabilities-access-program",
  "/grants/10-grant-opportunities/50-traditional-arts-apprenticeship",
  "/grants/10-grant-opportunities/30-artist-opportunities",
];
/** Today the connector reads 14 programme pages; more than this fails loudly. */
export const OHIO_MAX_CHILD_PAGES = OHIO_PROGRAMME_PATHS.length;
/** The absolute URL of every pinned programme page. */
export const OHIO_CHILD_PAGES: readonly string[] = OHIO_PROGRAMME_PATHS.map(
  (path) => `https://${OHIO_SOURCE_HOST}${path}`,
);
/**
 * The path prefixes stripped when deriving a record's own id from its page URL,
 * longest first — so a programme page keeps its own catalogue slug
 * (`45-capacity-building`) and a cycle amendment updates that same row.
 */
const OHIO_ID_PREFIXES = ["grants/10-grant-opportunities", "grants"] as const;

/** The longest kept row/token verbatim (a reviewer reads words, not a dump). */
export const OHIO_ROW_MAX_CHARS = 200;

/** Collapses whitespace and clips at a word boundary, marking the clip. */
function clipVerbatim(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= OHIO_ROW_MAX_CHARS) return text;
  const cut = text.slice(0, OHIO_ROW_MAX_CHARS);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at === -1 ? OHIO_ROW_MAX_CHARS : at).trim()}…`;
}

/** Real month names only — a capitalised word ("Agency 2022") is never a date. */
const MONTH_NAME =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
/** A full published day as the pages write it ("November 1, 2026", "Feb. 1, 2026"). */
const DAY_TEXT_RE = new RegExp(
  `\\b${MONTH_NAME}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`,
  "g",
);
/** A month-and-year period ("November 2024"): never a day, never a deadline. */
const MONTH_YEAR_RE = new RegExp(`\\b${MONTH_NAME}\\.?\\s+(?:19|20)\\d{2}\\b`, "g");
/** The source's own label for a row that IS an application deadline. */
const APPLICATION_DEADLINE_LABEL_RE = /^Application\s+Deadline\b/i;

/** Every day the text publishes, parsed exactly (year-less forms yield nothing). */
function daysInText(text: string): { day: string; text: string }[] {
  const out: { day: string; text: string }[] = [];
  for (const m of text.matchAll(DAY_TEXT_RE)) {
    const day = parseStateDay(m[0]);
    if (day !== null) out.push({ day, text: m[0].trim() });
  }
  return out;
}

/** The page's own `<li>` rows, each stripped to its text (the label→date read). */
export function ohioLabelledRows(regionHtml: string): string[] {
  const rows: string[] = [];
  for (const m of regionHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = stripTags(m[1] ?? "");
    if (text.length > 0) rows.push(text);
  }
  return [...new Set(rows)];
}

/** One row (or prose token) the connector refuses to publish as a deadline. */
export interface OhioRefusal {
  /** The source's own words, verbatim (clipped). */
  text: string;
  /** Machine-readable kind, so the ledger can be counted and reviewed. */
  kind: string;
  /** Why this is never a posted, close or estimated date. */
  reason: string;
}

/** The kind of a labelled row that is NOT an application deadline. */
function refusedRowKind(label: string): string {
  if (/^\**\s*Grant Agreement Deadline/i.test(label)) return "grant-agreement-deadline";
  if (/Final Report Deadline/i.test(label)) return "final-report-deadline";
  if (/Off-year Update Deadline/i.test(label)) return "off-year-update-deadline";
  if (/Application\s+(?:Available\s+)?in\s+ARTIE|Application Available in ARTIE/i.test(label)) {
    return "application-available-in-artie";
  }
  if (/Grant Award Announcement/i.test(label)) return "grant-award-announcement";
  if (/Financial Materials Due/i.test(label)) return "financial-materials-due";
  if (/Contract Submission Deadline/i.test(label)) return "contract-submission-deadline";
  return "other-labelled-row";
}

/** The label of a labelled row: the text before its value's last colon. */
function rowLabel(row: string): string {
  const at = row.lastIndexOf(":");
  const raw = at === -1 ? row : row.slice(0, at);
  return raw.replace(/^\**\s*/, "").trim();
}

/** What one programme page discloses about its own application deadline(s). */
export interface OhioDeadlineRead {
  /** The LATEST labelled application-deadline day, or null (never interpolated). */
  closeDate: string | null;
  /** The chosen row's own words, verbatim, or null. */
  closeRowText: string | null;
  /** The chosen row's own date text, verbatim, or null. */
  closeDayText: string | null;
  /** Every earlier labelled application-deadline row, verbatim, newest first. */
  earlierRows: string[];
  /** How many labelled application-deadline rows the page publishes with a day. */
  labelledRowCount: number;
  /** Every other date-like token on the page, refused verbatim. */
  refused: OhioRefusal[];
}

/**
 * Reads ONE page's labelled application deadlines and refuses everything else.
 * PURE: the caller passes the page's body region.
 */
export function ohioDeadlineRead(regionHtml: string): OhioDeadlineRead {
  const pageText = stripTags(regionHtml);
  const rows = ohioLabelledRows(regionHtml);
  const chosen: { day: string; text: string; dayText: string }[] = [];
  const refused: OhioRefusal[] = [];
  const push = (text: string, kind: string, reason: string): void => {
    const value = clipVerbatim(text);
    if (value.length === 0) return;
    if (refused.some((r) => r.text === value && r.kind === kind)) return;
    refused.push({ text: value, kind, reason });
  };

  for (const row of rows) {
    const label = rowLabel(row);
    const days = daysInText(row);
    const isApplicationDeadline = APPLICATION_DEADLINE_LABEL_RE.test(label);
    if (isApplicationDeadline) {
      if (days.length === 1) {
        const only = days[0]!;
        chosen.push({ day: only.day, text: clipVerbatim(row), dayText: only.text });
        continue;
      }
      // Several different days in ONE row is a multi-track cycle we cannot
      // resolve, and a bare month/year is not a day at all: both are refused.
      push(
        row,
        "application-deadline-row-without-one-published-day",
        days.length > 1
          ? "the row publishes several different days (a multi-track cycle), so no single closing date is picked"
          : "the row's value is not a full published day (a bare month/year or relative wording), so no date is invented",
      );
      continue;
    }
    const monthYears = [...row.matchAll(MONTH_YEAR_RE)].map((m) => m[0]);
    if (days.length === 0 && monthYears.length === 0) continue;
    push(
      row,
      refusedRowKind(label),
      `the source labels this row "${label}" — it is not an application deadline, so it is never published as a posted, close or estimated date`,
    );
  }

  // The page's prose and the furniture around the body: any date-like token that
  // is not inside a row above is refused too (the site's own news dates, the ADAP
  // enactment date, and any date the narrative mentions).
  let residual = pageText;
  for (const row of rows) residual = residual.split(row).join(" ");
  for (const m of residual.matchAll(DAY_TEXT_RE)) {
    const day = parseStateDay(m[0]);
    push(
      m[0],
      day === null ? "date-notation-outside-a-labelled-row" : "page-prose-or-furniture-date",
      "this date appears in the page's prose or in the site furniture around the body (its own news dates are included), not in a row the source labels — it is never read as a deadline",
    );
  }
  for (const m of residual.matchAll(MONTH_YEAR_RE)) {
    push(
      m[0],
      "month-and-year-period",
      "a month and a year is a period, not a published day, so it never becomes a close date",
    );
  }

  const ordered = [...chosen].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const latest = ordered[0] ?? null;
  return {
    closeDate: latest?.day ?? null,
    closeRowText: latest?.text ?? null,
    closeDayText: latest?.dayText ?? null,
    earlierRows: ordered.slice(1).map((r) => r.text),
    labelledRowCount: chosen.length,
    refused,
  };
}

/** The page's own h1 — the Council's own name for the programme. */
function pageTitle(html: string): string | null {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return null;
  const title = stripTags(match[1] ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}

/**
 * Parses the fetched corpus into normalised, unclassified records. ONE record per
 * pinned programme page — the catalogue index itself contributes no record and no
 * date. Every record's only date is the page's own latest labelled application
 * deadline (or null); nothing is inferred.
 */
export function parseOhioPages(raw: string): SourceGrantRecord[] {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateSourceError("parse", "Ohio payload is empty");
  }
  if (!raw.includes(OHIO_INDEX_MARKER) && !raw.includes(OHIO_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Ohio payload does not come from ${OHIO_SOURCE_NAME}: it carries neither the catalogue's ` +
        `"${OHIO_INDEX_MARKER}" marker nor a page's "${OHIO_CONTENT_MARKER}" body region — refusing to parse it`,
    );
  }
  const records: SourceGrantRecord[] = [];
  const nextId = uniqueExternalIdFactory();
  for (const page of splitSourcePages(raw)) {
    // The catalogue index never contributes a record or a date.
    if (page.url.length === 0 || page.url === OHIO_SOURCE_URL) continue;
    if (!OHIO_CHILD_PAGES.includes(page.url)) continue;
    if (!page.html.includes(OHIO_CONTENT_MARKER)) {
      throw new StateSourceError(
        "parse",
        `Ohio programme page ${page.url} no longer carries the site's "${OHIO_CONTENT_MARKER}" body region — refusing to read dates off an unrecognised page`,
      );
    }
    const title = pageTitle(page.html);
    if (title === null) continue;
    const region = contentRegion(page.html, OHIO_CONTENT_MARKER, OHIO_BODY_END_MARKERS);
    const read = ohioDeadlineRead(region);
    const slug = externalIdFromPath(page.url, [...OHIO_ID_PREFIXES]) ?? "programme";
    records.push({
      sourceKey: OHIO_CONNECTOR_ID,
      stateCode: "OH",
      externalId: nextId(`${OHIO_CONNECTOR_ID}-${slug}`),
      title,
      agency: OHIO_AGENCY,
      summary: NOT_SPECIFIED,
      url: page.url,
      sourceUrl: OHIO_SOURCE_URL,
      // The page publishes no posting date for a cycle, and an "Application
      // Available in ARTIE" row cannot be attributed to one cycle: null, never
      // an association we cannot make.
      postedDate: null,
      closeDate: read.closeDate,
      estimatedCloseDate: null,
      // Never the source's own words: this catalogue declares no programme
      // ongoing or closed, so the shared classifier decides from the one
      // published deadline alone.
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
        programmePageUrl: page.url,
        listedBy: OHIO_SOURCE_URL,
        programmeTitle: title,
        // The ONE reader in this connector: the source's own labelled
        // application-deadline rows, read on stripped text.
        applicationDeadlineReader: "latest-labelled-application-deadline-row-only",
        closeDateLabelText: read.closeRowText,
        closeDateLabelDayText: read.closeDayText,
        // The same source text under the shared harness's own key name (the
        // live gate spot-checks that the source's published deadline text is
        // present on the live page — see connectors/live-validation-harness).
        applicationDeadline: read.closeDayText,
        closeDateIsLatestLabelledApplicationDeadlineRow: read.closeDate !== null,
        labelledApplicationDeadlineRowCount: read.labelledRowCount,
        // Every earlier cycle's own row, verbatim — nothing is rolled forward.
        earlierApplicationDeadlineRows: read.earlierRows,
        closeDateReadFromThisProgrammesOwnPage: true,
        // No heading scoping: 13 of the 14 pages have no `<h2>TIMELINE</h2>`, so
        // the rows are found by their own label instead.
        timelineHeadingNeverUsedAsScope: true,
        // An opening date is never associated with a cycle (see the header).
        openingDateNeverRead: true,
        // Every other date-like token on THIS page, verbatim and never promoted.
        refusedDates: read.refused,
        refusedDatesNeverCloseDates: true,
        // The catalogue index publishes dates of its own (news items); none is read.
        indexDatesNeverRead: true,
        readOnlyFromThisProgrammesOwnPage: true,
        // WHY OHIO IS `limited`: the statewide portal is not readable over
        // verified TLS, so this is ONE agency's catalogue, not statewide coverage.
        statewidePortalNotReadable: true,
        statewidePortalNote:
          "Ohio's statewide funding-opportunities JSON (api.obm.ohio.gov) is not readable over verified TLS: that host sends only its leaf certificate, so curl, bun and node all fail verification. This connector therefore reads ONE agency's programme catalogue, which is why Ohio is `limited` and never statewide coverage.",
      },
    });
  }
  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      `Ohio payload carried the marker but none of the ${OHIO_CHILD_PAGES.length} pinned programme pages — a changed catalogue is not an empty one`,
    );
  }
  return records;
}

/** The Ohio Arts Council grant-programme connector. */
export const ohioConnector: StateGrantConnector<string> = {
  id: OHIO_CONNECTOR_ID,
  stateCode: "OH",
  stateName: "Ohio",
  sourceName: OHIO_SOURCE_NAME,
  agency: OHIO_AGENCY,
  sourceUrl: OHIO_SOURCE_URL,
  officialHost: OHIO_SOURCE_HOST,
  sourceValidationTest: OHIO_SOURCE_VALIDATION_TEST,
  async fetch(): Promise<string> {
    // The catalogue plus every pinned programme page. Any failure — including one
    // pinned page — throws, and the run writes nothing.
    return fetchStateGrantPages({
      indexUrl: OHIO_SOURCE_URL,
      marker: OHIO_INDEX_MARKER,
      label: "Ohio Arts Council grants",
      approvedHosts: OHIO_APPROVED_HOSTS,
      minBytes: 20_000,
      childMinBytes: 20_000,
      childMarker: OHIO_CONTENT_MARKER,
      maxChildren: OHIO_MAX_CHILD_PAGES,
      // PINNED, not link-derived: the catalogue also links its portal shell, the
      // grants calendar, the ARTIE login and the news pages.
      childUrls: () => [...OHIO_CHILD_PAGES],
    });
  },
  parse(raw: string): SourceGrantRecord[] {
    return parseOhioPages(raw);
  },
  classify(record: SourceGrantRecord, now?: Date | number): GrantClassification {
    return classifyStateGrant(record, now);
  },
};
