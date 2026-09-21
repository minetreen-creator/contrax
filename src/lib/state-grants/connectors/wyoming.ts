/**
 * WYOMING CONNECTOR — state grants NATIONWIDE workstream (owner 2026-09-20; the
 * source recon and this build spec are the engineer's own decision-ready handoff,
 * `state-grants-wyoming-recon-handoff-2026-09-20.md`; raw captures fetched
 * 2026-09-20 to /opt/t12/wy/ and trimmed into `fixtures/wy-*.html`).
 *
 * OFFICIAL SOURCE (hard-coded):
 *   https://wyomingbusiness.org/business/financing/grants/
 * WHY THIS IS OFFICIAL: it is the **Wyoming Business Council**'s own grants
 * catalogue (the Business Council names itself on all 11 pages), it is served
 * from the Council's own `wyomingbusiness.org` domain, it needs no key, and it is
 * a server-rendered WordPress/Elementor catalogue of programme pages. Both hosts
 * are approved (the bare host is what the pages themselves link to).
 *
 * WHY THE PROGRAMME LIST IS PINNED RATHER THAN LINK-DERIVED. The index also links
 * the loan programmes, the equity/special-assessment pages, the State Loan and
 * Investment Board and `/program-applications/` — none of which is an
 * application programme page with its own body of grant copy. The 10 pages below
 * are the catalogue's own programmes and are PINNED; the fan-out is bounded by
 * that list, so the connector can never widen what it reads on its own.
 *
 * WHAT THIS SOURCE ACTUALLY PUBLISHES — AND WHY NO DATE ON IT IS READABLE.
 * Verified live 2026-09-20, page by page (the handoff's probe table):
 *   - The index publishes NO date token of its own (159 KB, zero dates).
 *   - kickstart: "The Kickstart Grant Program is **currently paused until further
 *     notice**." — the agency's own words ⇒ `closed`, no date. Its "one
 *     competition cycle per calendar quarter" and "applications can be submitted
 *     at any time" are RULES, and its worked example ("submitted between April 1
 *     and June 30") is not a deadline.
 *   - sbir: "Applications are **open year-round**" + "evaluated on a **rolling
 *     basis**" — the source's own declaration ⇒ `rolling`, no close date.
 *   - rural-development-grant: "Application deadlines are 2x/year: **March 1 and
 *     September 1**" — YEAR-LESS, so no year is invented and the record keeps no
 *     close date; the page's stale "will reopen by Jan. 1, 2024" is two years past.
 *   - state-trade-expansion-program: "The **grant period** is July 1, 2026, to
 *     September 29, 2027" is a PERIOD OF PERFORMANCE, not an application
 *     deadline; the reimbursement "due date" binds an already-awarded grantee.
 *   - building-resilient-communities: a deadline TABLE whose cells are year-less
 *     ("February 1st", "June 1st"/"August 1st", several struck through).
 *   - community-development-block-grant: an "Application Deadlines" section that
 *     links only a "2019-2020 … Application and Award Schedule".
 *   - startup-financing: a process timeline whose only date is a RELATIVE day
 *     ("Application deadline (Day 90)").
 *   - market-expansion-grant / brownfields-rlf / financial-incentives: no date
 *     token and no status sentence of their own.
 * SO: **there is no accepted-deadline reader in this connector at all.** Nothing
 * on this source qualifies as a published application deadline, so every
 * date-like token is REFUSED into `raw.refusedDates` verbatim (with
 * `refusedDatesNeverCloseDates: true`) and every record keeps `postedDate`,
 * `closeDate` and `estimatedCloseDate` null. `unverified` is the honest home for
 * a programme whose page publishes no confirmable cycle — exactly the Arkansas /
 * Kansas / Rhode Island footing — and NOT a single date here is guessed,
 * inferred, or estimated. The two statuses that ARE the agency's own words
 * (`closed` for kickstart's pause, `rolling` for SBIR's year-round acceptance)
 * are read from those words alone.
 *
 * NARROW BY CONSTRUCTION. This is ONE agency's programme catalogue of ONE state.
 * Wyoming awards funding through other departments, boards and local bodies we
 * have NOT validated, so the state is `limited` — never `curated`/`connected`.
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
  externalIdFromPath,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";

/** The catalogue the connector fetches FIRST (the listing it names as `listedBy`). */
export const WYOMING_SOURCE_URL = "https://wyomingbusiness.org/business/financing/grants/";
export const WYOMING_SOURCE_HOST = "wyomingbusiness.org";
export const WYOMING_APPROVED_HOSTS: readonly string[] = [
  "wyomingbusiness.org",
  "www.wyomingbusiness.org",
];
/** The publishing body, in the pages' own words. */
export const WYOMING_AGENCY = "Wyoming Business Council";
export const WYOMING_SOURCE_NAME =
  "Wyoming Business Council — Grants catalogue and programme pages";
export const WYOMING_CONNECTOR_ID = "wy-grants";
export const WYOMING_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/wyoming.source-validation.test.ts";

/**
 * The body region every page on this site publishes (index and programme pages
 * alike): the Elementor region the site tags `wp-page`. Verified present EXACTLY
 * ONCE on all 11 captured pages; the site's other regions are tagged `header`
 * and `footer`, so the region ends at the next `footer` tag.
 */
export const WYOMING_INDEX_MARKER = 'data-elementor-type="wp-page"';
export const WYOMING_CHILD_MARKER = 'data-elementor-type="wp-page"';
/** The site's own marker for the region AFTER the body (never read). */
export const WYOMING_BODY_END_MARKER = 'data-elementor-type="footer"';

/**
 * The programme pages this connector reads, PINNED (never link-derived) — the
 * catalogue's own programmes, in the catalogue's own path shape. The index also
 * links loans, equity, the State Loan and Investment Board and
 * `/program-applications/`: none of those is an application programme page.
 */
export const WYOMING_PROGRAMME_PATHS: readonly string[] = [
  "/business/financing/grants/kickstart",
  "/business/financing/grants/sbir",
  "/business/expand/expand-your-market/market-expansion-grant",
  "/business/financing/financial-incentives",
  "/business/financing/loans/brownfields-rlf",
  "/business/start/startup-financing",
  "/communities/financing/building-resilient-communities",
  "/communities/financing/community-development-block-grant",
  "/communities/financing/rural-development-grant",
  "/business/expand/state-trade-expansion-program",
];
/** Today the connector reads 10 programme pages; more than this fails loudly. */
export const WYOMING_MAX_CHILD_PAGES = WYOMING_PROGRAMME_PATHS.length;
/** The absolute URL of every pinned programme page. */
export const WYOMING_CHILD_PAGES: readonly string[] = WYOMING_PROGRAMME_PATHS.map(
  (path) => `https://${WYOMING_SOURCE_HOST}${path}`,
);
/**
 * The path prefixes stripped when deriving a record's own id from its page URL,
 * longest first (so `business/financing/grants/kickstart` keeps `kickstart`).
 */
const WYOMING_ID_PREFIXES = [
  "business/financing/grants",
  "business/financing/loans",
  "business/expand/expand-your-market",
  "business/financing",
  "business/expand",
  "business/start",
  "communities/financing",
] as const;

// ── The source's own status wording (the ONLY statuses it declares) ──────────
/** SBIR's own year-round / rolling declaration ⇒ `rolling`, with no date. */
const ROLLING_RE = /\bopen year-round\b|\brolling basis\b/i;
/** The agency's own words for a programme it has halted. */
const NOT_ACCEPTING_RE = /currently paused|not\s+(?:currently\s+)?accepting applications/i;

// ── The refusals: every date-like token this source publishes ────────────────
const MONTH_FULL =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTH_ANY =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
/**
 * Every pattern below produces the source's OWN words verbatim; nothing here is
 * ever promoted to a date. The list is deliberately explicit and auditable:
 *   1. a labelled period of performance ("grant period is <…>");
 *   2. a year-less month/day PAIR ("March 1 and September 1");
 *   3. a year-less month/day ("February 1st");
 *   4. a full published day ("July 1, 2026", "Jan. 1, 2024");
 *   5. a year RANGE used as a document label ("2019-2020 … Schedule");
 *   6. a RELATIVE day in a process timeline ("Application deadline (Day 90)");
 *   7. a bare capitalised month label ("May", "September December");
 *   8. a bare year ("2018 USEPA grant", "2025 BRC Annual Report").
 */
const REFUSED_PATTERNS: readonly RegExp[] = [
  /\bgrant period is\s+[^.]{4,160}/gi,
  new RegExp(`\\b(?:${MONTH_ANY})\\.?\\s+${DAY}\\s+and\\s+(?:${MONTH_ANY})\\.?\\s+${DAY}`, "gi"),
  new RegExp(`\\b(?:${MONTH_ANY})\\.?\\s+${DAY}\\b(?!\\s*,?\\s*(?:19|20)\\d{2})`, "gi"),
  new RegExp(`\\b(?:${MONTH_ANY})\\.?\\s+\\d{1,2},?\\s+(?:19|20)\\d{2}\\b`, "gi"),
  /\b(?:19|20)\d{2}\s*[-\u2013]\s*(?:19|20)\d{2}\b[^.]{0,80}/gi,
  /[A-Za-z][A-Za-z ]{0,40}\(Day\s*\d+\)/g,
  new RegExp(`\\b(?:${MONTH_FULL})\\b(?!\\s+\\d)`, "g"),
  /\b(?:19|20)\d{2}\b/g,
];

/** The longest refused token kept verbatim (a reviewer reads words, not a dump). */
export const WYOMING_REFUSAL_MAX_CHARS = 120;

/** Collapses whitespace and clips at a word boundary, marking the clip. */
function clipVerbatim(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= WYOMING_REFUSAL_MAX_CHARS) return text;
  const cut = text.slice(0, WYOMING_REFUSAL_MAX_CHARS);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at === -1 ? WYOMING_REFUSAL_MAX_CHARS : at).trim()}…`;
}

/**
 * Every date-like token on a page's own body, verbatim and de-duplicated, in
 * document order. A reviewer can re-derive from this why no record carries a
 * date; nothing here is ever a close date (see `refusedDatesNeverCloseDates`).
 */
export function wyomingRefusedDates(bodyText: string): string[] {
  const out: string[] = [];
  for (const re of REFUSED_PATTERNS) {
    for (const match of bodyText.matchAll(re)) {
      const value = clipVerbatim(match[0]);
      if (value.length > 0) out.push(value);
    }
  }
  return [...new Set(out)];
}

/** What one programme page publishes about its own application status. */
export interface WyomingPageStatus {
  /** True only when the agency's own words say the programme is halted. */
  closed: boolean;
  /** The agency's own halting sentence, verbatim, or null. */
  closedSentence: string | null;
  /** True only when the agency's own words declare the programme open-ended. */
  rolling: boolean;
  /** The agency's own year-round / rolling sentence, verbatim, or null. */
  rollingSentence: string | null;
  /** Every date-like token on the page, refused verbatim. */
  refused: string[];
}

/** The sentence around a position, for storing the source's own words verbatim. */
function sentenceAround(text: string, at: number): string {
  const before = text.lastIndexOf(".", at);
  const after = text.indexOf(".", at);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? text.length : after + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Reads ONE programme page's own status sentence and refused dates. */
export function wyomingPageStatus(bodyText: string): WyomingPageStatus {
  const closedAt = bodyText.search(NOT_ACCEPTING_RE);
  const rollingAt = bodyText.search(ROLLING_RE);
  return {
    closed: closedAt !== -1,
    closedSentence: closedAt === -1 ? null : sentenceAround(bodyText, closedAt),
    rolling: rollingAt !== -1,
    rollingSentence: rollingAt === -1 ? null : sentenceAround(bodyText, rollingAt),
    refused: wyomingRefusedDates(bodyText),
  };
}

/** The body region of one page: the site's own `wp-page` region, never the furniture. */
function pageBody(html: string): string {
  const start = html.indexOf(WYOMING_CHILD_MARKER);
  if (start === -1) return html;
  const rest = html.slice(start);
  const end = rest.indexOf(WYOMING_BODY_END_MARKER);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The page's own h1 — the agency's own name for the programme. */
function pageTitle(html: string): string | null {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return null;
  const title = stripTags(match[1] ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}

/**
 * Parses the fetched corpus into normalised, unclassified records. ONE record per
 * pinned programme page — the index itself contributes no record and no date.
 * Every record's dates are null by construction: this connector has no
 * accepted-deadline reader (see the header).
 */
export function parseWyomingPages(raw: string): SourceGrantRecord[] {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateSourceError("parse", "Wyoming payload is empty");
  }
  if (!raw.includes(WYOMING_INDEX_MARKER) && !raw.includes(WYOMING_CHILD_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Wyoming payload does not come from ${WYOMING_SOURCE_NAME}: it carries neither the listing's ` +
        `nor a programme page's "${WYOMING_CHILD_MARKER}" body region — refusing to parse it`,
    );
  }
  const records: SourceGrantRecord[] = [];
  const nextId = uniqueExternalIdFactory();
  for (const page of splitSourcePages(raw)) {
    // The index itself never contributes a record or a date.
    if (page.url.length === 0 || page.url === WYOMING_SOURCE_URL) continue;
    if (!WYOMING_CHILD_PAGES.includes(page.url)) continue;
    const title = pageTitle(page.html);
    if (title === null) continue;
    const body = pageBody(page.html);
    const status = wyomingPageStatus(stripTags(body));
    const slug = externalIdFromPath(page.url, [...WYOMING_ID_PREFIXES]) ?? "programme";
    records.push({
      sourceKey: WYOMING_CONNECTOR_ID,
      stateCode: "WY",
      externalId: nextId(`${WYOMING_CONNECTOR_ID}-${slug}`),
      title,
      agency: WYOMING_AGENCY,
      summary: NOT_SPECIFIED,
      url: page.url,
      sourceUrl: WYOMING_SOURCE_URL,
      // No deadline is ever read off this source, so no date is ever published.
      postedDate: null,
      closeDate: null,
      estimatedCloseDate: null,
      // `rolling` only on the agency's own year-round / rolling words.
      ongoing: status.rolling,
      sourceClosed: status.closed,
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
        listedBy: WYOMING_SOURCE_URL,
        // The agency's own h1 for the programme, verbatim.
        programmeTitle: title,
        sourceClosedDeclaredBySource: status.closed,
        closedSentence: status.closed ? status.closedSentence : null,
        rollingDeclaredBySource: status.rolling,
        rollingSentence: status.rolling ? status.rollingSentence : null,
        // No accepted-deadline reader exists in this connector — nothing on this
        // source qualifies as a published application deadline.
        noAcceptedDeadlineReader: true,
        // Every date-like token the page publishes, verbatim and never promoted.
        refusedDates: status.refused,
        refusedDatesNeverCloseDates: true,
        // Every fact above came from THIS programme's own body region.
        readOnlyFromThisProgrammesOwnPage: true,
        // The listing publishes no date of its own; nothing on it is read.
        indexDatesNeverRead: true,
      },
    });
  }
  return records;
}

/** The Wyoming Business Council programme connector. */
export const wyomingConnector: StateGrantConnector<string> = {
  id: WYOMING_CONNECTOR_ID,
  stateCode: "WY",
  stateName: "Wyoming",
  sourceName: WYOMING_SOURCE_NAME,
  agency: WYOMING_AGENCY,
  sourceUrl: WYOMING_SOURCE_URL,
  officialHost: WYOMING_SOURCE_HOST,
  sourceValidationTest: WYOMING_SOURCE_VALIDATION_TEST,
  async fetch(): Promise<string> {
    // The catalogue (its own body region as the marker) plus every pinned
    // programme page. Any failure — including one pinned page — throws, and the
    // run writes nothing.
    return fetchStateGrantPages({
      indexUrl: WYOMING_SOURCE_URL,
      marker: WYOMING_INDEX_MARKER,
      label: "Wyoming Business Council grants",
      approvedHosts: WYOMING_APPROVED_HOSTS,
      minBytes: 10_000,
      childMinBytes: 4_000,
      childMarker: WYOMING_CHILD_MARKER,
      maxChildren: WYOMING_MAX_CHILD_PAGES,
      // PINNED, not link-derived: the catalogue also links loans, equity, the
      // SLIB board and the applications hub, none of which is a programme page.
      childUrls: () => [...WYOMING_CHILD_PAGES],
    });
  },
  parse(raw: string): SourceGrantRecord[] {
    return parseWyomingPages(raw);
  },
  classify(record: SourceGrantRecord, now?: Date | number): GrantClassification {
    return classifyStateGrant(record, now);
  },
};
