/**
 * NEW HAMPSHIRE CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR; build spec §C, NH).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.visitnh.gov/industry-members/work-together/grants/jpp-program
 * WHY THIS IS OFFICIAL: it is the **New Hampshire Division of Travel and Tourism
 * Development**'s own Joint Promotional Program page — visitnh.gov is the
 * Division's own domain and it sits inside the Department of Business and
 * Economic Affairs (DRED), the agency the phase-1 map named for New Hampshire.
 * It is server-rendered HTML: no key, no login, no JavaScript.
 *
 * SOURCE-CHOICE NOTE (provenance). The phase-1 map's PRIMARY candidate for New
 * Hampshire was `nheconomy.com/about-us/grant-programs` — a DIFFERENT agency (the
 * Business and Economic Affairs programmes catalogue) which publishes ten grant
 * links and ZERO dates live (Class B: its dates live on child pages we have not
 * validated). The DATED listing for the state is this one, and the registry note
 * says exactly whose it is: this connector reads ONE programme of ONE division
 * inside DRED, so the state is `limited` and never `curated` (the ladder reserves
 * `curated` for a state's own curated/portal listing).
 *
 * WHAT THE PAGE PUBLISHES: a "JPP FY<year> Deadlines" list with one `<strong>Round
 * N:</strong>` item per application round, and inside each round two of the
 * Division's own labelled values:
 *     Application Due Date: 6/24/2026
 *     Applicants Notified: 7/8/2026
 *
 * HONESTY TRAPS HANDLED HERE
 *   - "APPLICANTS NOTIFIED" IS NOT A DEADLINE. It is the date applicants hear the
 *     outcome; reading it (or the whole two-date list item) as the closing date
 *     would publish a notification date as a submission deadline. Only the value
 *     the page labels "Application Due Date" is read.
 *   - THE DEADLINES LIST IS A ROUND LIST, NOT ONE DATE. The Division publishes
 *     four rounds; each round is a separate submission window with its own
 *     deadline, so the connector serves one record per round with THAT round's
 *     own date. Taking the first, the last or the whole cell would invent a
 *     deadline the source never published.
 *   - A PASSED ROUND IS `closed`, A FUTURE ROUND IS `open`. The page is live and
 *     still lists Round 1 (due 6/24/2026, in the past): the Division's own dates
 *     decide, so a live page is never a reason to serve a finished round as open.
 *   - NO ROUND PUBLISHES AN OPENING DATE, so `postedDate` stays null for every
 *     record; the state is derived from the closing date alone (a future
 *     published deadline is `open`), never from an invented opening day.
 *   - The `https://visitnh.grantplatform.com/` submission link is the Division's
 *     own door to its grant front end; it is NOT on the approved hosts, so a
 *     record's `url` stays the listing page rather than pointing a user at a
 *     third-party portal.
 *   - The page publishes no amount, eligibility or geography in a machine-
 *     labelable form, so those fields stay NOT_SPECIFIED/empty.
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
  contentRegion,
  fetchStateGrantSource,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const NEW_HAMPSHIRE_SOURCE_URL =
  "https://www.visitnh.gov/industry-members/work-together/grants/jpp-program";
export const NEW_HAMPSHIRE_SOURCE_HOST = "www.visitnh.gov";
export const NEW_HAMPSHIRE_APPROVED_HOSTS: readonly string[] = [
  "visitnh.gov",
  "www.visitnh.gov",
];
/** The publishing body, in the page's own words (asserted against the live text). */
export const NEW_HAMPSHIRE_AGENCY = "New Hampshire Joint Promotional Program (JPP)";
export const NEW_HAMPSHIRE_SOURCE_NAME =
  "NH Division of Travel and Tourism Development — Joint Promotional Program (JPP)";
export const NEW_HAMPSHIRE_CONNECTOR_ID = "nh-dred-jpp-program";
export const NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/new-hampshire.source-validation.test.ts";

/** The Division's own label for the one value in this list that IS a deadline. */
export const NEW_HAMPSHIRE_CONTENT_MARKER = "Application Due Date";
/** Where the deadlines list ends (the page's own next heading). */
export const NEW_HAMPSHIRE_REGION_END_MARKERS: readonly string[] = [
  "Rules/State Laws",
  "Helpful Hints for JPP Applicants",
];

/** The Division's own heading, e.g. "JPP FY2027 Deadlines". */
const ROUND_HEADING_RE = /JPP\s+FY\s*\d{4}\s+Deadlines/i;
/** Each round is introduced by its own bold label. */
const ROUND_SPLIT_RE = /<strong>\s*Round\s+(\d+)\s*:?\s*<\/strong>/i;
/** The two labelled values a round publishes. */
const DUE_LABEL_RE = /Application Due Date\s*:\s*([\s\S]*)/i;
const NOTIFIED_LABEL_RE = /Applicants Notified\s*:\s*([\s\S]*)/i;

/** The value the page publishes after one of its own labels, or null. */
function labelledValue(text: string, label: RegExp): string | null {
  const m = label.exec(text);
  if (!m) return null;
  const value = (m[1] ?? "").trim().replace(/[\s.;]+$/, "");
  return value.length > 0 ? value : null;
}

/** The index of one of the page's own labels inside a round block, or -1. */
function labelIndex(text: string, label: RegExp): number {
  const m = label.exec(text);
  return m ? (m.index ?? -1) : -1;
}

/** Parses the JPP deadlines list into UNCLASSIFIED records — one per round. */
export function parseNewHampshireJppPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(NEW_HAMPSHIRE_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `New Hampshire source payload is not the expected JPP program page (marker ${JSON.stringify(
        NEW_HAMPSHIRE_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const heading = ROUND_HEADING_RE.exec(html)?.[0] ?? NEW_HAMPSHIRE_CONTENT_MARKER;
  const region = contentRegion(html, heading, NEW_HAMPSHIRE_REGION_END_MARKERS);
  const fiscalYear = /FY\s*(\d{4})/i.exec(heading)?.[1] ?? null;
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  // `split` with one capture group interleaves: [pre, roundNo, block, roundNo, block…]
  const parts = region.split(new RegExp(ROUND_SPLIT_RE.source, "gi"));
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const roundNumber = (parts[i] ?? "").trim();
    const block = stripTags(parts[i + 1] ?? "");
    if (!/^\d+$/.test(roundNumber)) continue;
    // NOTIFIED first: its whole label (and its date) is cut out, so a
    // notification date can never be read as this or any later round's deadline.
    const notifiedAt = labelIndex(block, NOTIFIED_LABEL_RE);
    const notified = labelledValue(block, NOTIFIED_LABEL_RE);
    const dueText = labelledValue(
      notifiedAt === -1 ? block : block.slice(0, notifiedAt),
      DUE_LABEL_RE,
    );
    const day = dueText === null ? null : singlePublishedDay(dueText);
    const title = `New Hampshire Joint Promotional Program (JPP) — ${
      fiscalYear === null ? "Deadlines" : `FY${fiscalYear}`
    } Round ${roundNumber}`;

    records.push({
      sourceKey: NEW_HAMPSHIRE_CONNECTOR_ID,
      stateCode: "NH",
      externalId: nextId(
        `${fiscalYear === null ? "jpp" : `jpp-fy${fiscalYear}`}-round-${roundNumber}`,
      ),
      title,
      agency: NEW_HAMPSHIRE_AGENCY,
      summary: NOT_SPECIFIED,
      // The submission link is on a third-party grant platform, so a record's
      // page stays the Division's own listing (never an unapproved host).
      url: NEW_HAMPSHIRE_SOURCE_URL,
      sourceUrl: NEW_HAMPSHIRE_SOURCE_URL,
      // The page publishes no opening date for a round — null, never inferred.
      postedDate: null,
      closeDate: day,
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
        round: roundNumber,
        fiscalYear,
        dueText,
        closingText: dueText,
        applicationDeadline: dueText,
        applicationDueDateText: dueText,
        openingText: null,
        openingDayPublishedBySource: null,
        closingDayPublishedBySource: day,
        // The Division's other label in this list — never a deadline.
        applicantsNotifiedText: notified,
        applicantsNotifiedIsNeverADeadline: true,
        pagePublishesNoOpeningDateForARound: true,
        roundsAreSeparateSubmissionWindows: true,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "New Hampshire JPP deadlines list parsed to zero rounds — the page changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyNewHampshireRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const newHampshireConnector: StateGrantConnector<string> = {
  id: NEW_HAMPSHIRE_CONNECTOR_ID,
  stateCode: "NH",
  stateName: "New Hampshire",
  sourceName: NEW_HAMPSHIRE_SOURCE_NAME,
  agency: NEW_HAMPSHIRE_AGENCY,
  sourceUrl: NEW_HAMPSHIRE_SOURCE_URL,
  officialHost: NEW_HAMPSHIRE_SOURCE_HOST,
  sourceValidationTest: NEW_HAMPSHIRE_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: NEW_HAMPSHIRE_SOURCE_URL,
      marker: NEW_HAMPSHIRE_CONTENT_MARKER,
      label: "New Hampshire",
      approvedHosts: NEW_HAMPSHIRE_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseNewHampshireJppPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyNewHampshireRecord(record, now);
  },
};
