/**
 * WEST VIRGINIA CONNECTOR — state grants NATIONWIDE workstream, tranche
 * DC/WV/KY/AL/ME (owner nationwide order 2026-09-19; source map §WV).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://wvculture.org/agencies/arts/grants/
 * WHY THIS IS OFFICIAL: it is the **West Virginia Division of Culture and
 * History, Arts Section**'s own grants page, on the Division's own domain
 * (`wvculture.org` is the division's own site — the same approved-host class as
 * `vatc.org` / `arkansasheritage.com`; the discovery report's §4 allowlist
 * decision names `wvculture.org` explicitly). It is server-rendered WordPress
 * HTML, needs no key, no login and no JavaScript.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE section (Arts) of ONE division.
 * West Virginia publishes funding through other departments we have NOT
 * validated, so the registry reports West Virginia as `limited`.
 *
 * WHAT THE PAGE PUBLISHES: two explicitly labelled sections — "Currently Open for
 * Application:" and "Not Currently Open for Application:" — each holding one
 * `<p>` per program with the program's own name, its own labelled
 * "Application Deadline:" value, and a "Description:".
 *
 * HONESTY TRAPS HANDLED HERE
 *   - ONLY THE LABELLED DEADLINE VALUE IS READ. The values are the source's own
 *     ("October 1, 2026 at 4:59pm", "Rolling", "Not Currently Open"); the prose
 *     is never scanned for a date, so the many guideline dates inside the page's
 *     link text can never become deadlines.
 *   - "Rolling" IS THE SOURCE'S OWN WORD and is the ONLY way a record here
 *     becomes `rolling` (four mini-grants publish exactly that value).
 *   - "Not Currently Open" IS NOT A DEADLINE AND NOT AN OPEN CYCLE. The two
 *     programs the page files under "Not Currently Open for Application:" publish
 *     that exact value; the connector records them as the source's own
 *     past-tense/closed state (`sourceClosed`), keeps the verbatim value in
 *     `raw`, and never invents a date for them.
 *   - THE FINAL-REPORT DATE IS NOT AN APPLICATION DEADLINE. The page later says
 *     "**Final Reports for all FY26 grants are due September 28, 2026**" — a
 *     reporting date for grants already awarded. The parse region ends before
 *     that block (`Acknowledging Support:` / `Final Report Forms`), so it can
 *     never become a closing date.
 *   - Every record's URL is pinned to the listing: the only per-card links are
 *     the GOapply portal (`goapply2.akoyago.com`) and sample-application
 *     documents on `drive.google.com`, and NEITHER is an approved host — the
 *     discovery report §4 explicitly rejects `docs.google.com` links as sources.
 *   - The page publishes no structured eligibility / geography / award / match
 *     values, so those fields stay NOT_SPECIFIED/empty — never inferred.
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
  fetchStateGrantSource,
  firstHref,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const WEST_VIRGINIA_SOURCE_URL = "https://wvculture.org/agencies/arts/grants/";
export const WEST_VIRGINIA_SOURCE_HOST = "wvculture.org";
export const WEST_VIRGINIA_APPROVED_HOSTS: readonly string[] = ["wvculture.org", "www.wvculture.org"];
export const WEST_VIRGINIA_AGENCY = "West Virginia Division of Culture and History, Arts Section";
export const WEST_VIRGINIA_SOURCE_NAME =
  "West Virginia Division of Culture and History, Arts Section — Arts Grants";
export const WEST_VIRGINIA_CONNECTOR_ID = "wv-culture-arts-grants";
export const WEST_VIRGINIA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/west-virginia.source-validation.test.ts";

/** The listing's own section heading — present only on this page. */
export const WEST_VIRGINIA_CONTENT_MARKER =
  "<strong>Currently Open for Application:</strong>";

/** Where the opportunity listing ends (the thanking/acknowledgement block). */
export const WEST_VIRGINIA_REGION_END_MARKERS: readonly string[] = [
  "<strong>Acknowledging Support:</strong>",
];

const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const DEADLINE_LABEL_RE = /\bApplication Deadline\s*:/i;
const DESCRIPTION_LABEL_RE = /\bDescription\s*:/i;
/** The source's own value for a program it files as not currently open. */
const NOT_CURRENTLY_OPEN_RE = /^not currently open\b/i;

/** The first `<strong>` element's own text in a fragment, or null. */
function firstStrongText(html: string): string | null {
  const m = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(html);
  if (!m) return null;
  const text = stripTags(m[1] ?? "");
  return text.length > 0 ? text : null;
}

/**
 * The source's own value for one of its labels, read from the LABEL's own
 * `<br>`-delimited line. Returns the raw value and its parsed day (null when the
 * value is not a single exact day — "Rolling", "Not Currently Open").
 */
function labelledValue(block: string, labelRe: RegExp): string | null {
  for (const segment of block.split(/<br\s*\/?>/i)) {
    const text = stripTags(segment);
    const m = labelRe.exec(text);
    if (!m) continue;
    const value = text.slice(m.index + m[0].length).trim().replace(/[\s.]+$/, "");
    if (value.length > 0) return value;
  }
  return null;
}

/** Parses the Arts grants listing into UNCLASSIFIED records. */
export function parseWestVirginiaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(WEST_VIRGINIA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `West Virginia source payload is not the expected Arts Grants page (marker ${JSON.stringify(
        WEST_VIRGINIA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(
    html,
    WEST_VIRGINIA_CONTENT_MARKER,
    WEST_VIRGINIA_REGION_END_MARKERS,
  );
  const blocks = [...region.matchAll(PARAGRAPH_RE)].map((m) => m[1] ?? "");
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const block of blocks) {
    const value = labelledValue(block, DEADLINE_LABEL_RE);
    if (value === null) continue; // a heading or prose paragraph, not a program
    const title = firstStrongText(block);
    if (!title || title.length < 3) continue;

    // The deadline value is the ONLY thing that can make this record rolling:
    // the source publishes "Rolling" as the value itself.
    const ongoing = declaresOngoing(value);
    const notCurrentlyOpen = NOT_CURRENTLY_OPEN_RE.test(value);
    const day = ongoing || notCurrentlyOpen ? null : singlePublishedDay(value);
    const description = labelledValue(block, DESCRIPTION_LABEL_RE);

    records.push({
      sourceKey: WEST_VIRGINIA_CONNECTOR_ID,
      stateCode: "WV",
      externalId: nextId(slugify(title)),
      title,
      agency: WEST_VIRGINIA_AGENCY,
      summary: description && description.length > 0 ? description : NOT_SPECIFIED,
      // The card's only links are the GOapply portal and Google-hosted sample
      // applications — both off the allowlist, so `officialUrl` pins the record
      // to the listing page itself (never to an unverified host).
      url: officialUrl(firstHref(block), {
        baseUrl: WEST_VIRGINIA_SOURCE_URL,
        approvedHosts: WEST_VIRGINIA_APPROVED_HOSTS,
        canonicalHost: WEST_VIRGINIA_SOURCE_HOST,
      }),
      sourceUrl: WEST_VIRGINIA_SOURCE_URL,
      postedDate: null,
      closeDate: day,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed: notCurrentlyOpen,
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
        deadlineValue: value,
        // The source's own value, verbatim — the ONLY deadline input.
        closingText: value,
        applicationDueDateText: value,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: notCurrentlyOpen,
        sourceDeclaresNotCurrentlyOpen: notCurrentlyOpen,
        closingDayPublishedBySource: day,
        // The connector reads only the labelled APPLICATION DEADLINE value, so
        // the page's final-report date can never become a deadline here.
        pagePublishesOnlyALabelledApplicationDeadline: true,
        declaredApplicationDeadlineDay: day !== null ? parseStateDay(day) : null,
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "West Virginia source parsed to zero programs — the Arts Grants listing changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyWestVirginiaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const westVirginiaConnector: StateGrantConnector<string> = {
  id: WEST_VIRGINIA_CONNECTOR_ID,
  stateCode: "WV",
  stateName: "West Virginia",
  sourceName: WEST_VIRGINIA_SOURCE_NAME,
  agency: WEST_VIRGINIA_AGENCY,
  sourceUrl: WEST_VIRGINIA_SOURCE_URL,
  officialHost: WEST_VIRGINIA_SOURCE_HOST,
  sourceValidationTest: WEST_VIRGINIA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: WEST_VIRGINIA_SOURCE_URL,
      marker: WEST_VIRGINIA_CONTENT_MARKER,
      label: "West Virginia",
      approvedHosts: WEST_VIRGINIA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseWestVirginiaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyWestVirginiaRecord(record, now);
  },
};
