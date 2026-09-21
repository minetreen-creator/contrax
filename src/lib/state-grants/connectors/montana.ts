/**
 * MONTANA CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR; build spec §C, MT).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://commerce.mt.gov/Business/Programs-and-Services/Tourism-Marketing/
 *     Tourism-Grant-Program/Montana-Tourism-Development-Grant-Program
 * WHY THIS URL IS THE SOURCE AND NOT ITS PARENT: the parent Tourism Grant Program
 * page (322 KB live, 45 mentions of "grant", ZERO dates) is a PROGRAM CATALOGUE —
 * parsing it could only ever produce all-`unverified` records, which the build
 * spec's rule A.2 says does NOT earn a tier. The dated listing is this CHILD page,
 * on the same `commerce.mt.gov` host, and it is the Department of Commerce's own
 * programme page. Server-rendered: no key, no login, no JavaScript.
 *
 * WHAT THE PAGE PUBLISHES: a "Resources for Applicants:" list whose first item is
 * the Department's own sentence for the cycle —
 *     "The 2027 Montana Tourism Development Grant cycle will open Jan. 6, 2027
 *      and close on Feb. 3, 2027."
 * — an ORDERED open/close pair in the source's own words.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE PAIR IS READ IN SOURCE ORDER AND NEVER PICKED APART. "open X and close
 *     on Y" is the Department's own labelling of the two ends, so the first end is
 *     the opening day and the second is the closing day; the connector reads both
 *     and invents neither. With the opening day still in the future the cycle is
 *     `upcoming` with a published close date — not `open`.
 *   - A YEAR-LESS OR UNPARSEABLE END YIELDS NO DATE. Both ends go through
 *     `singlePublishedDay`, so a sentence the Department rewords to "opens this
 *     winter" produces an undated record rather than a fabricated deadline.
 *   - 2023 IS HISTORICAL, NEVER OPEN. The page's other date-bearing sentences
 *     (the 2023 SB 540 note, the SB 409 material) are not read at all: only the
 *     "will open … and close on …" sentence of the cycle is the deadline input,
 *     and a passed pair classifies `closed`, never open.
 *   - NARROW BY CONSTRUCTION. This is ONE programme family (tourism development
 *     grants) of ONE department. The Montana Arts Council's own `art.mt.gov`
 *     pages are stale (2022) or award lists and are deliberately NOT used;
 *     `commerce.mt.gov/grants` 404s. The state is therefore `limited`, and the
 *     registry note says the coverage is one programme, not statewide.
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

export const MONTANA_SOURCE_URL =
  "https://commerce.mt.gov/Business/Programs-and-Services/Tourism-Marketing/Tourism-Grant-Program/Montana-Tourism-Development-Grant-Program";
export const MONTANA_SOURCE_HOST = "commerce.mt.gov";
export const MONTANA_APPROVED_HOSTS: readonly string[] = [
  "commerce.mt.gov",
  "www.commerce.mt.gov",
];
/** The publishing body, in the page's own words. */
export const MONTANA_AGENCY = "Montana Department of Commerce";
export const MONTANA_SOURCE_NAME =
  "Montana Department of Commerce — Montana Tourism Development Grant Program";
export const MONTANA_CONNECTOR_ID = "mt-commerce-tourism-development-grant";
export const MONTANA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/montana.source-validation.test.ts";

/** The page's own heading above the dated sentence. */
export const MONTANA_CONTENT_MARKER = "Resources for Applicants";
/** The programme's own name, as the page writes it. */
export const MONTANA_PROGRAM_TITLE = "Montana Tourism Development Grant Program";

/**
 * The Department's own ordered "open <day> … close on <day>" sentence. Both ends
 * are captured separately; the words between them ("and", "on") are the source's
 * own, and the capture order is the source's own order.
 */
const CYCLE_SENTENCE_RE =
  /\bopen[s]?\b[\s\S]{0,40}?([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)[\s\S]{0,80}?\bclose[sd]?\b[\s\S]{0,30}?([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi;
/** A cycle sentence is about a grant programme; anything else is not a cycle. */
const CYCLE_CONTEXT_RE = /\b(?:grant|cycle)\b/i;

/** Parses the MTDGP page into UNCLASSIFIED records (one cycle). */
export function parseMontanaTourismGrantPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(MONTANA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Montana source payload is not the expected MTDGP page (marker ${JSON.stringify(
        MONTANA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const text = stripTags(html);
  const at = text.indexOf(MONTANA_CONTENT_MARKER);
  // The dated sentence sits in the applicant-resources list under the marker; a
  // bounded window keeps it from being read from anywhere else on the page.
  const region = at === -1 ? "" : text.slice(at, at + 4000);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  // Every ordered open/close pair the Department publishes inside the applicant-
  // resources region. In practice this is one cycle sentence; the loop keeps a
  // rewording that publishes several cycles honest (each pair its own record).
  for (const match of region.matchAll(new RegExp(CYCLE_SENTENCE_RE.source, "gi"))) {
    const at2 = match.index ?? 0;
    const context = region.slice(Math.max(0, at2 - 240), at2);
    if (!CYCLE_CONTEXT_RE.test(context)) continue;
    const openDay = singlePublishedDay(match[1] ?? "");
    const closeDay = singlePublishedDay(match[2] ?? "");
    // A pair whose ends do not parse exactly is kept as an UNDATED record: the
    // cycle exists and is published, its dates simply are not readable days.
    const cycleYear = (match[2] ?? match[1] ?? "").match(/\b(\d{4})\b/)?.[1] ?? null;
    const title =
      cycleYear === null ? MONTANA_PROGRAM_TITLE : `${MONTANA_PROGRAM_TITLE} (${cycleYear} cycle)`;
    records.push({
      sourceKey: MONTANA_CONNECTOR_ID,
      stateCode: "MT",
      externalId: nextId(
        cycleYear === null ? "montana-tourism-development-grant-program" : `mtdgp-${cycleYear}`,
      ),
      title,
      agency: MONTANA_AGENCY,
      summary: NOT_SPECIFIED,
      url: MONTANA_SOURCE_URL,
      sourceUrl: MONTANA_SOURCE_URL,
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
        cycleSentence: match[0],
        openingText: match[1] ?? null,
        closingText: match[2] ?? null,
        applicationDueDateText: match[2] ?? null,
        openingDayPublishedBySource: openDay,
        closingDayPublishedBySource: closeDay,
        // The Department's own two ends, read in source order; never picked.
        orderedOpenThenCloseSentence: true,
        pagePublishesOtherHistoricalYearsNotReadAsCycles: true,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Montana MTDGP page parsed to zero dated cycles — the applicant-resources list changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyMontanaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const montanaConnector: StateGrantConnector<string> = {
  id: MONTANA_CONNECTOR_ID,
  stateCode: "MT",
  stateName: "Montana",
  sourceName: MONTANA_SOURCE_NAME,
  agency: MONTANA_AGENCY,
  sourceUrl: MONTANA_SOURCE_URL,
  officialHost: MONTANA_SOURCE_HOST,
  sourceValidationTest: MONTANA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: MONTANA_SOURCE_URL,
      marker: MONTANA_CONTENT_MARKER,
      label: "Montana",
      approvedHosts: MONTANA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseMontanaTourismGrantPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyMontanaRecord(record, now);
  },
};
