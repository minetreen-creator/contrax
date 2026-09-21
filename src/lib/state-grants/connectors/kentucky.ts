/**
 * KENTUCKY CONNECTOR — state grants NATIONWIDE workstream, tranche DC/WV/KY/AL/ME
 * (owner nationwide order 2026-09-19; source map §KY and its ARCHIVE TRAP).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://artscouncil.ky.gov/program-type/grants/
 * WHY THIS IS OFFICIAL: it is the **Kentucky Arts Council**'s own program listing
 * — a state agency of the Commonwealth — on its own `.gov` domain. It is
 * server-rendered WordPress HTML, needs no key, no login and no JavaScript; each
 * program card carries its `<h4>` name, a machine-readable
 * `<time datetime="…">` application deadline, a description, and a "Read More"
 * link to that program's own page on the same host.
 *
 * ── THE ARCHIVE TRAP, VERIFIED LIVE (2026-09-19) ─────────────────────────────
 * The page's `<title>` reads "Grants **Archives** - Kentucky Arts Council",
 * exactly the shape that made the Tennessee `/grants/` page unusable. It was
 * therefore checked against the checklist's current-vs-past rule BEFORE any
 * record was written, and it is NOT an archive of past cycles:
 *   - WordPress titles EVERY taxonomy-listing page "<term> Archives"; this page
 *     is the `program-type` taxonomy listing, i.e. "every program of type
 *     Grants", not a history of closed batches;
 *   - its deadlines run BOTH ways across today (2026-09-19): two are in the
 *     future (October 3, 2026 and March 31, 2027) and eight have passed — a
 *     listing of each program's currently published deadline, not a
 *     closed-only record set;
 *   - the programs' own pages publish the SAME live deadline — the Poetry Out
 *     Loud Registration page (`/program/poetry-out-loud-program/`, fetched
 *     2026-09-19) itself reads "Application Deadline: October 3, 2026" next to a
 *     "Register Here" link, so the listing's value is the current cycle's value.
 * A past deadline published by the source is reported `closed` (never open),
 * which is exactly what the owner's rules require; nothing is presented as open
 * because the page is still live.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's program listing.
 * Kentucky publishes funding through other departments we have NOT validated, so
 * the registry reports Kentucky as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE DEADLINE IS THE SOURCE'S OWN MACHINE-READABLE VALUE. Each card
 *     publishes `<time datetime="October 3, 2026">`; the connector reads that
 *     labelled value (falling back to the `<time>` element's own text), never a
 *     date guessed out of a description.
 *   - "ROLLING" IS NEVER INFERRED FROM PROSE. Two descriptions contain words the
 *     shared `declaresOngoing()` would match ("Kentucky Arts Rising … year-round
 *     arts programming", "Arts Miles … accepted on a rolling basis between
 *     October and March") while the page publishes an exact deadline on each of
 *     them. A record here can only become `rolling` when the LABELLED deadline
 *     VALUE itself says rolling and publishes no day — the same "read the label,
 *     not the paragraph" rule the Utah and Tennessee connectors follow. (The Arts
 *     Miles wording also carves out a period, which the Arkansas precedent
 *     refuses outright.)
 *   - The listing publishes no structured eligibility / geography / award / match
 *     values, so those fields stay NOT_SPECIFIED/empty — nothing inferred.
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  parseStateDay,
  slugify,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import {
  StateSourceError,
  contentRegion,
  declaresOngoing,
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const KENTUCKY_SOURCE_URL = "https://artscouncil.ky.gov/program-type/grants/";
export const KENTUCKY_SOURCE_HOST = "artscouncil.ky.gov";
export const KENTUCKY_APPROVED_HOSTS: readonly string[] = [
  "artscouncil.ky.gov",
  "www.artscouncil.ky.gov",
];
export const KENTUCKY_AGENCY = "Kentucky Arts Council";
export const KENTUCKY_SOURCE_NAME =
  "Kentucky Arts Council — Grants (program listing with each program's published application deadline)";
export const KENTUCKY_CONNECTOR_ID = "ky-arts-council-grants";
export const KENTUCKY_SOURCE_VALIDATION_TEST = "src/lib/state-grants/kentucky.source-validation.test.ts";

/** The page's own program-list container id — present only on this listing. */
export const KENTUCKY_CONTENT_MARKER = '<div id="program-list">';

/** Where the listing ends (the site footer follows the program cards). */
export const KENTUCKY_REGION_END_MARKERS: readonly string[] = ['<footer class="footer'];

/** One card per program; the inner content div has a different class string. */
const CARD_MARKER = 'class="program-card relative';

const TITLE_RE = /<h4\b[^>]*>([\s\S]*?)<\/h4>/i;
const TIME_RE = /<time\b[^>]*datetime="([^"]*)"[^>]*>([\s\S]*?)<\/time>/i;
const READ_MORE_RE = /<a\b[^>]*href="([^"]+)"[^>]*>\s*Read More/i;
const DESCRIPTION_RE = /<div class="program-card-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

/** Parses the Kentucky Arts Council program listing into UNCLASSIFIED records. */
export function parseKentuckyGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(KENTUCKY_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Kentucky source payload is not the expected Grants listing (marker ${JSON.stringify(
        KENTUCKY_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, KENTUCKY_CONTENT_MARKER, KENTUCKY_REGION_END_MARKERS);
  const cards = region.split(CARD_MARKER).slice(1);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const card of cards) {
    const titleMatch = TITLE_RE.exec(card);
    const title = titleMatch ? stripTags(titleMatch[1] ?? "") : "";
    if (title.length < 3) continue;

    // The source's own machine-readable deadline value, and its rendered text.
    const timeMatch = TIME_RE.exec(card);
    const datetimeValue = timeMatch ? (timeMatch[1] ?? "").trim() : "";
    const renderedValue = timeMatch ? stripTags(timeMatch[2] ?? "") : "";
    const labelValue = datetimeValue.length > 0 ? datetimeValue : renderedValue;
    // The labelled value is the ONLY deadline input — never the description.
    const day = labelValue.length > 0 ? (parseStateDay(labelValue) ?? singlePublishedDay(labelValue)) : null;
    // `rolling` requires the LABELLED value itself to declare it (see the header).
    const ongoing = day === null && labelValue.length > 0 && declaresOngoing(labelValue);

    const readMore = READ_MORE_RE.exec(card);
    const url = officialUrl(readMore ? (readMore[1] ?? null) : null, {
      baseUrl: KENTUCKY_SOURCE_URL,
      approvedHosts: KENTUCKY_APPROVED_HOSTS,
      canonicalHost: KENTUCKY_SOURCE_HOST,
    });
    // The source's own identifier for the program: its own page path.
    const externalId = externalIdFromPath(url, ["program"]) ?? slugify(title);

    const descriptionMatch = DESCRIPTION_RE.exec(card);
    const summary = descriptionMatch ? stripTags(descriptionMatch[1] ?? "") : "";

    records.push({
      sourceKey: KENTUCKY_CONNECTOR_ID,
      stateCode: "KY",
      externalId: nextId(externalId),
      title,
      agency: KENTUCKY_AGENCY,
      summary: summary.length > 0 ? summary : NOT_SPECIFIED,
      url,
      sourceUrl: KENTUCKY_SOURCE_URL,
      postedDate: null,
      closeDate: day,
      estimatedCloseDate: null,
      ongoing,
      // The listing marks no cycle closed in words; a passed published deadline
      // is what makes a record `closed`, and the shared classifier does that.
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
        deadlineValue: labelValue,
        closingText: renderedValue.length > 0 ? renderedValue : null,
        applicationDueDateText: renderedValue.length > 0 ? renderedValue : null,
        deadlineValueIsMachineReadableTimeElement: datetimeValue.length > 0,
        rollingDeclaredByTheLabelledDeadlineValue: ongoing,
        sourceClosedDeclaredBySource: false,
        closingDayPublishedBySource: day,
        // The listing is a program directory whose WordPress taxonomy title reads
        // "Grants Archives"; that was verified to be a taxonomy name, not a
        // closed-cycle history (see the header) before any record was served.
        listingTitleIsTaxonomyArchiveNotAClosedCycleHistory: true,
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Kentucky source parsed to zero programs — the program listing changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyKentuckyRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const kentuckyConnector: StateGrantConnector<string> = {
  id: KENTUCKY_CONNECTOR_ID,
  stateCode: "KY",
  stateName: "Kentucky",
  sourceName: KENTUCKY_SOURCE_NAME,
  agency: KENTUCKY_AGENCY,
  sourceUrl: KENTUCKY_SOURCE_URL,
  officialHost: KENTUCKY_SOURCE_HOST,
  sourceValidationTest: KENTUCKY_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: KENTUCKY_SOURCE_URL,
      marker: KENTUCKY_CONTENT_MARKER,
      label: "Kentucky",
      approvedHosts: KENTUCKY_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseKentuckyGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyKentuckyRecord(record, now);
  },
};
