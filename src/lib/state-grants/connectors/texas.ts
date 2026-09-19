/**
 * TEXAS CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR; build spec §C, TX).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://gov.texas.gov/organization/military/grants
 * WHY THIS URL AND NOT THE SPEC'S SUGGESTED CATALOGUE: the spec's first candidate
 * (`/organization/financial-services/grants`) is a Class B PROGRAM CATALOGUE —
 * re-verified live 2026-09-19 at 105,109 bytes with ZERO dates, as are
 * `/organization/hsgd` (97,673 B) and `/organization/cjd/resources` (96,669 B).
 * Parsing those could only ever produce all-`unverified` records, which the build
 * spec's rule A.2 says does NOT earn a tier. The Governor's office DOES publish one
 * dated opportunity listing on its own host: the Texas Military Preparedness
 * Commission's DEAAG page. Server-rendered: no key, no login, no JavaScript.
 *
 * WHAT THE PAGE PUBLISHES (verbatim, one paragraph, the programme's own words):
 *     "The FY 27 Round of DEAAG will open on September 1, 2026. DEAAG applications
 *      will be due on or before 5 PM Friday, November 06, 2026. Grants will be
 *      awarded at the beginning of 2027."
 * — an ORDERED opening day and the source's own due day, plus an AWARD timing that
 * is deliberately not read.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE TWO ENDS COME FROM THE SAME PARAGRAPH, IN SOURCE ORDER. "will open on X"
 *     is the opening day and "due on or before … Y" is the closing day; both are
 *     the Commission's own labels. No date is ever taken from elsewhere on the page
 *     (the page also carries a 2026 brochure filename and an FY27/FY2026 mix).
 *   - THE AWARD ANNOUNCEMENT IS NEVER A DEADLINE. "Grants will be awarded at the
 *     beginning of 2027" is kept in `raw` and pinned by a test; it can never become
 *     a posted/close/estimated date (the award-vs-deadline trap the workstream has
 *     hit before).
 *   - A YEAR-LESS OR UNPARSEABLE END YIELDS NO DATE. Both ends go through
 *     `singlePublishedDay`, so a sentence the Commission rewords ("opens this
 *     fall") produces an undated record rather than a fabricated deadline.
 *   - NARROW BY CONSTRUCTION. This is ONE programme family (DEAAG) of the
 *     Governor's office. The financial-services grants catalogue publishes no
 *     per-programme dates, so the state is `limited` and the registry note says the
 *     coverage is one programme, not statewide.
 *   - The page publishes no amount/eligibility/geography in a machine-labelable
 *     form, so those fields stay NOT_SPECIFIED/empty.
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

export const TEXAS_SOURCE_URL = "https://gov.texas.gov/organization/military/grants";
export const TEXAS_SOURCE_HOST = "gov.texas.gov";
export const TEXAS_APPROVED_HOSTS: readonly string[] = [
  "gov.texas.gov",
  "www.gov.texas.gov",
];
/** The publishing body, in the page's own words (the breadcrumb and the body). */
export const TEXAS_AGENCY = "Texas Military Preparedness Commission";
export const TEXAS_SOURCE_NAME =
  "Texas Military Preparedness Commission (Office of the Governor) — DEAAG grant program";
export const TEXAS_CONNECTOR_ID = "tx-governor-deaag-grant-program";
export const TEXAS_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/texas.source-validation.test.ts";

/** The programme's own name, as the page and its breadcrumb write it. */
export const TEXAS_CONTENT_MARKER = "Defense Economic Adjustment Assistance Grant";
/** The programme's own short name, used in the record title. */
export const TEXAS_PROGRAM_TITLE = "Defense Economic Adjustment Assistance Grant (DEAAG)";

/**
 * The Commission's own opening day: "The FY 27 Round of DEAAG will open on
 * September 1, 2026." Only the day the source itself attaches to "will open on".
 */
const CYCLE_OPEN_RE = /\bwill\s+open\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i;
/**
 * The Commission's own due day: "DEAAG applications will be due on or before 5 PM
 * Friday, November 06, 2026." ("due on <day>" is the same statement reworded.)
 */
const CYCLE_DUE_RE =
  /\bdue\s+on(?:\s+or\s+before)?\s+(?:[^.]{0,40}?)([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i;
/** The award timing sentence — captured for review and NEVER read as a date. */
const AWARD_SENTENCE_RE = /\bgrants?\s+will\s+be\s+awarded\b[^.]{0,120}\./i;
/** A cycle paragraph is about this programme's grant round. */
const CYCLE_CONTEXT_RE = /\bDEAAG\b/;
/** The round's own label, e.g. "FY 27". */
const ROUND_RE = /\bFY\s*(\d{2})\b/;

/** One `<p>` block of the page, as plain text. */
function paragraphs(html: string): { text: string }[] {
  const out: { text: string }[] = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1] ?? "").trim();
    if (text.length > 0) out.push({ text });
  }
  return out;
}

/** The page's own h1 (the programme name the Governor's office publishes for it). */
function texasPageTitle(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const text = m ? stripTags(m[1] ?? "").replace(/\s+/g, " ").trim() : "";
  return text.length > 0 ? text : null;
}

/** Parses the DEAAG page into UNCLASSIFIED records (one dated grant round). */
export function parseTexasDeaagPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(TEXAS_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Texas source payload is not the expected DEAAG page (marker ${JSON.stringify(
        TEXAS_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  // Every paragraph that publishes THIS programme's own dated round. Each one is
  // its own record: its two ends are read from that paragraph only, never from a
  // sibling paragraph, the breadcrumb or the page footer.
  for (const { text } of paragraphs(html)) {
    if (!CYCLE_CONTEXT_RE.test(text)) continue;
    const openMatch = CYCLE_OPEN_RE.exec(text);
    const dueMatch = CYCLE_DUE_RE.exec(text);
    if (openMatch === null && dueMatch === null) continue;
    const openDay = openMatch === null ? null : singlePublishedDay(openMatch[1] ?? "");
    const closeDay = dueMatch === null ? null : singlePublishedDay(dueMatch[1] ?? "");
    const round = ROUND_RE.exec(text)?.[1] ?? null;
    const roundLabel = round === null ? null : `FY ${round}`;
    const title = roundLabel === null ? TEXAS_PROGRAM_TITLE : `${TEXAS_PROGRAM_TITLE} (${roundLabel})`;
    records.push({
      sourceKey: TEXAS_CONNECTOR_ID,
      stateCode: "TX",
      externalId: nextId(round === null ? "texas-deaag-grant-program" : `deaag-fy-${round}`),
      title,
      agency: TEXAS_AGENCY,
      summary: NOT_SPECIFIED,
      url: TEXAS_SOURCE_URL,
      sourceUrl: TEXAS_SOURCE_URL,
      // The opening day the Commission published; null when it published none.
      postedDate: openDay,
      closeDate: closeDay,
      estimatedCloseDate: null,
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
        cycleParagraph: text,
        openingText: openMatch?.[1] ?? null,
        closingText: dueMatch?.[1] ?? null,
        applicationDueDateText: dueMatch?.[1] ?? null,
        roundLabel,
        openingDayPublishedBySource: openDay,
        closingDayPublishedBySource: closeDay,
        // The Commission's own ordered opening/due pair, read in source order.
        orderedOpenThenDueSentence: true,
        // The award timing the same paragraph publishes — review only, never a date.
        awardAnnouncementText: AWARD_SENTENCE_RE.exec(text)?.[0] ?? null,
        awardAnnouncementIsNeverADeadline: true,
        datesReadOnlyFromThisProgramsOwnParagraph: true,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Texas DEAAG page parsed to zero dated grant rounds — the programme paragraph changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyTexasRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const texasConnector: StateGrantConnector<string> = {
  id: TEXAS_CONNECTOR_ID,
  stateCode: "TX",
  stateName: "Texas",
  sourceName: TEXAS_SOURCE_NAME,
  agency: TEXAS_AGENCY,
  sourceUrl: TEXAS_SOURCE_URL,
  officialHost: TEXAS_SOURCE_HOST,
  sourceValidationTest: TEXAS_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: TEXAS_SOURCE_URL,
      marker: TEXAS_CONTENT_MARKER,
      label: "Texas",
      approvedHosts: TEXAS_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseTexasDeaagPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyTexasRecord(record, now);
  },
};
