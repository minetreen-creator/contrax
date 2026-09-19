/**
 * NEW MEXICO CONNECTOR — state grants NATIONWIDE workstream, batch 2
 * (owner nationwide order 2026-09-19; source chosen from the phase-1 discovery
 * report row NM and re-verified against the raw capture by the batch-2 design
 * session; fixture cut from the 2026-09-19 capture).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://nmarts.org/grants/apply-for-a-grant/
 * WHY THIS IS OFFICIAL: it is published by **New Mexico Arts** (the state arts
 * agency, a division of the Department of Cultural Affairs) on the agency's own
 * domain — the same approved class as `vatc.org` and `arkansasheritage.com` — it
 * is server-rendered, needs no key, and publishes the cycle's labelled deadlines
 * in the source's own words ("must be submitted by the published deadline of
 * 11:59 PM MT October 23, 2026."). HTTP 200 at capture (260 317 B). The captured
 * page is the saved fixture the unit tests parse
 * (`fixtures/new-mexico-arts-apply.html`).
 *
 * THE CANDIDATES THAT WERE REJECTED (documented, never re-proposed):
 *   - https://nmarts.org/grants/ (→ /grants/grants-information/) publishes NO
 *     year-bearing date at all — only a month-only "Grant Application Life Cycle"
 *     (SEPTEMBER – Guidelines Available, OCTOBER – Advance Review Deadline, …).
 *     A month with no year can never become a date, and there is no rolling
 *     statement, so it cannot produce an honest record.
 *   - https://edd.newmexico.gov/grants/ — 24 mentions, ZERO dates. Not used.
 *   - https://nmarts.org/grant-opportunities/ → 404; nm.gov/grants → 404.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's application page. New
 * Mexico publishes funding through other agencies we have NOT validated, so the
 * registry reports New Mexico as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - The same page advertises WEBINARS ("When: Sep 23, 2026 10:00 AM Mountain
 *     Time"). An event time is not a deadline. Only a date that follows the
 *     page's own label **"published deadline of"** inside a deadline section can
 *     become a `closeDate`, so the webinar date can never be read as one.
 *   - The page's month-only life-cycle list is outside the parsed region
 *     ("Evaluation Criteria by Funding Category" ends it) and its month names
 *     carry no year anyway.
 *   - A section is `unverified` when its labelled deadline cannot be resolved to
 *     exactly ONE published day (several different days, or none) — nothing is
 *     picked or inferred.
 *   - The page publishes no eligibility, geography, award or match for these
 *     milestones, so those stay `NOT_SPECIFIED`/empty.
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
  fetchStateGrantSource,
  publishedDaysIn,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const NEW_MEXICO_SOURCE_URL = "https://nmarts.org/grants/apply-for-a-grant/";
export const NEW_MEXICO_SOURCE_HOST = "nmarts.org";
export const NEW_MEXICO_APPROVED_HOSTS: readonly string[] = ["nmarts.org", "www.nmarts.org"];
export const NEW_MEXICO_AGENCY = "New Mexico Arts";
export const NEW_MEXICO_SOURCE_NAME = "New Mexico Arts — Apply for a Grant";
export const NEW_MEXICO_CONNECTOR_ID = "nm-arts-apply-for-a-grant";
export const NEW_MEXICO_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/new-mexico.source-validation.test.ts";

/** The page's own h1 — the region start, asserted rather than assumed. */
export const NEW_MEXICO_REGION_START =
  '<h1 class="elementor-heading-title elementor-size-default">Apply for a Grant';
export const NEW_MEXICO_REGION_END_MARKERS: readonly string[] = [
  "Evaluation Criteria by Funding Category",
];

/**
 * The two sections that publish a LABELLED deadline. Each label is the page's own
 * `<h2>`, so the record's title is the source's own words.
 */
export const NEW_MEXICO_DEADLINE_SECTIONS: readonly string[] = [
  "Advance Review",
  "Final Deadline",
];

/** The page's own label for a real published deadline (never an event). */
const PUBLISHED_DEADLINE_LABEL_RE = /published deadline of/gi;
/** How far after the label a published day may sit (same sentence). */
const LABEL_WINDOW = 80;

/** The one day each labelled phrase in a section resolves to, or null. */
function labelledDays(sectionText: string): string[] {
  const days: string[] = [];
  for (const m of sectionText.matchAll(PUBLISHED_DEADLINE_LABEL_RE)) {
    const window = sectionText.slice(m.index, m.index + LABEL_WINDOW);
    const day = publishedDaysIn(window)[0];
    if (day) days.push(day);
  }
  return [...new Set(days)];
}

/** The sentence around the labelled deadline, so the record carries the source's own words. */
function labelledSentence(sectionText: string, index: number): string {
  const before = sectionText.lastIndexOf(". ", index);
  const from = before === -1 ? 0 : before + 2;
  const after = sectionText.indexOf(".", index + 10);
  const to = after === -1 ? sectionText.length : after + 1;
  return sectionText.slice(from, to).trim().slice(0, 400);
}

/** Parses "Apply for a Grant" into normalised, UNCLASSIFIED records. */
export function parseNewMexicoApplyPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(NEW_MEXICO_REGION_START)) {
    throw new StateSourceError(
      "parse",
      `New Mexico source payload is not the expected apply-for-a-grant page (marker ${JSON.stringify(
        NEW_MEXICO_REGION_START,
      )} missing) — refusing to parse the whole document`,
    );
  }
  const region = contentRegion(html, NEW_MEXICO_REGION_START, NEW_MEXICO_REGION_END_MARKERS);
  const h2s = [...region.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const label of NEW_MEXICO_DEADLINE_SECTIONS) {
    const headingIndex = h2s.findIndex((m) => stripTags(m[1] ?? "") === label);
    if (headingIndex === -1) continue;
    const heading = h2s[headingIndex]!;
    const sectionStart = (heading.index ?? 0) + heading[0].length;
    const nextHeading = h2s[headingIndex + 1];
    const sectionEnd = nextHeading ? nextHeading.index : region.length;
    const sectionText = stripTags(region.slice(sectionStart, sectionEnd));
    const days = labelledDays(sectionText);
    // Exactly one published day, or none is claimed (never a picked day).
    const closeDate = days.length === 1 ? days[0]! : null;
    const labelIndex = sectionText.search(PUBLISHED_DEADLINE_LABEL_RE);
    const closingText =
      labelIndex === -1 ? null : labelledSentence(sectionText, labelIndex);

    records.push({
      sourceKey: NEW_MEXICO_CONNECTOR_ID,
      stateCode: "NM",
      externalId: nextId(slugify(label)),
      title: label,
      agency: NEW_MEXICO_AGENCY,
      summary: closingText ?? NOT_SPECIFIED,
      // The deadline is a milestone of this one page: there is no per-milestone
      // page, so the record points at the agency's own listing page.
      url: NEW_MEXICO_SOURCE_URL,
      sourceUrl: NEW_MEXICO_SOURCE_URL,
      postedDate: null,
      closeDate,
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
        milestoneLabel: label,
        closingText,
        // The labelled days this section published, in source order. The date of a
        // WEBINAR on the same page never reaches this list (see the header).
        labelledDays,
        labelledDeadlineResolvedToExactlyOneDay: days.length === 1,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
        categoriesPublished: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "New Mexico source parsed to zero labelled deadlines — the page layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyNewMexicoRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const newMexicoConnector: StateGrantConnector<string> = {
  id: NEW_MEXICO_CONNECTOR_ID,
  stateCode: "NM",
  stateName: "New Mexico",
  sourceName: NEW_MEXICO_SOURCE_NAME,
  agency: NEW_MEXICO_AGENCY,
  sourceUrl: NEW_MEXICO_SOURCE_URL,
  officialHost: NEW_MEXICO_SOURCE_HOST,
  sourceValidationTest: NEW_MEXICO_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: NEW_MEXICO_SOURCE_URL,
      marker: NEW_MEXICO_REGION_START,
      label: "New Mexico",
      approvedHosts: NEW_MEXICO_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseNewMexicoApplyPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyNewMexicoRecord(record, now);
  },
};
