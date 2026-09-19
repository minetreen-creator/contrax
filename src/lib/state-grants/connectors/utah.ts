/**
 * UTAH CONNECTOR — state grants NATIONWIDE workstream, ESCALATION PASS
 * (owner escalation order 2026-09-19, checklist §0.5). Utah was one of the 14
 * UNCERTAIN jurisdictions and had already exited nationwide batch #1 under the
 * §0 exit rule (its then-known page was a 2.7 KB hub with a closed cycle). The
 * escalation re-probe found that the Division's own Project Grants page is now a
 * full, structured, dated listing (§③/④ conservative parse of an official page).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://artsandmuseums.utah.gov/project-grants/
 * WHY THIS IS OFFICIAL: it is the **Utah Division of Arts & Museums**' own page —
 * a division of the Utah Department of Cultural & Community Engagement, on the
 * state `.gov` domain — and it is plain server-rendered HTML (a Webflow build),
 * needing no key, no login and no JavaScript. The trimmed fixture is the saved
 * 2026-09-19 capture of that page (`fixtures/utah-arts-project-grants.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE page of ONE division. Utah
 * publishes funding through other agencies we have NOT validated, and this page
 * covers the Division's Project Grants only (its General Operating Support grants
 * are a separate page we do NOT read), so the registry reports Utah as `limited`,
 * never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - AN INFORMATION SESSION IS AN EVENT, NOT A DEADLINE. Each program publishes a
 *     dated "Info Session" / "Information Session" webinar (July 21 / July 22 /
 *     August 12, 2026) and a "Watch the info session recording" link. Those days
 *     are NOT deadlines, and the connector can never turn one into a closing date:
 *     it reads the day ONLY from a value the source itself labels
 *     "Grant Opens:" / "Grant Closes:" (`labelledDayIn`), so an event date is not
 *     even in scope. The session line is kept verbatim in `raw.infoSessionLine` on
 *     every record precisely so that a reader can see what was seen and skipped.
 *   - OPENING AND CLOSING ARE READ SEPARATELY. The two values live in one
 *     paragraph, separated by a line break; a naive "the day in this paragraph"
 *     read would see TWO days and (correctly) refuse both. Reading each labelled
 *     value on its own keeps both real dates without ever picking between them.
 *   - ROLLING IS DECIDED ON THE PROGRAM'S OWN SCHEDULE TEXT ONLY. The page uses
 *     the word "ongoing" elsewhere in a different sense ("Organizations that
 *     receive ongoing legislative pass-through funding … are not eligible"), so
 *     `declaresOngoing()` is applied to the labelled schedule text alone, never to
 *     the whole panel — otherwise an eligibility sentence would flip a program to
 *     `rolling`.
 *   - A PROGRAM WHOSE SCHEDULE PUBLISHES NO DAY IS STILL A RECORD, and it is
 *     `unverified`: it is never dropped (that would misreport the listing) and it
 *     is never dated by inference.
 *   - CYCLES THAT HAVE CLOSED ARE NOT DELETED. On 2026-09-19 all three programs'
 *     published closing dates (Aug 14 / Aug 17 / Aug 28, 2026) have passed, so the
 *     records classify `closed` — the honest reading. When the Division posts its
 *     next cycle on this same page, the connector reads those dates instead and
 *     the records move to `open` on their own; a re-run is an amendment, not a
 *     duplicate. Nothing is ever presented as open because a page is still live.
 *   - The page publishes no eligibility, geography, award or match text on these
 *     panels, so every one of those fields stays `NOT_SPECIFIED`/empty.
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
  declaresOngoing,
  fetchStateGrantSource,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const UTAH_SOURCE_URL = "https://artsandmuseums.utah.gov/project-grants/";
export const UTAH_SOURCE_HOST = "artsandmuseums.utah.gov";
export const UTAH_APPROVED_HOSTS: readonly string[] = [
  "artsandmuseums.utah.gov",
  "www.artsandmuseums.utah.gov",
];
export const UTAH_AGENCY = "Utah Division of Arts & Museums";
export const UTAH_SOURCE_NAME =
  "Utah Division of Arts & Museums — Project Grants (per-program grant opens/closes schedule)";
export const UTAH_CONNECTOR_ID = "ut-arts-museums-project-grants";
export const UTAH_SOURCE_VALIDATION_TEST = "src/lib/state-grants/utah.source-validation.test.ts";

/** The listing's own heading — present only on the Project Grants page. */
export const UTAH_CONTENT_MARKER =
  '<h1 class="x-text-content-text-primary">Project Support Grants</h1>';

/** Where the program list starts and ends inside the page. */
export const UTAH_REGION_START =
  '<h2 class="x-text-content-text-primary">Grants Information</h2>';
export const UTAH_REGION_END_MARKERS: readonly string[] = ["Grants Frequently Asked Questions"];

/**
 * One program panel per `<h3 class="psg heading">TITLE</h3>`. The subsection
 * headings inside a panel are `<h4>` (Informational Webinar, What Can We Apply
 * For, …), so splitting on `<h3>` yields exactly the programs and never a
 * subsection.
 */
const PROGRAM_HEADING_RE = /<h3 class="psg heading">([\s\S]*?)<\/h3>/gi;

/** The value the source ITSELF labels as the opening / closing of the cycle. */
function labelledDayIn(block: string, label: string): string | null {
  const re = new RegExp(
    `<strong>\\s*${label}:?\\s*</strong>([\\s\\S]*?)(?:<br\\s*\\/?>|</p>|</div>|$)`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return null;
  return singlePublishedDay(m[1] ?? "");
}

/** The labelled value as published, tags stripped (for `raw`). */
function labelledTextIn(block: string, label: string): string | null {
  const re = new RegExp(
    `<strong>\\s*${label}:?\\s*</strong>([\\s\\S]*?)(?:<br\\s*\\/?>|</p>|</div>|$)`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return null;
  const text = stripTags(m[1] ?? "");
  return text.length > 0 ? text : null;
}

/** A dated information-session line, which is NEVER a deadline (kept in `raw`). */
const INFO_SESSION_RE = /(?:Info|Information) Session:\s*([^<]*)/i;

/** Parses the Project Grants page into UNCLASSIFIED records. */
export function parseUtahGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(UTAH_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Utah source payload is not the expected Project Grants page (marker ${JSON.stringify(
        UTAH_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, UTAH_REGION_START, UTAH_REGION_END_MARKERS);
  if (!region.includes("Grant Opens:") && !region.includes("Grant Closes:")) {
    throw new StateSourceError(
      "parse",
      "Utah source no longer publishes the per-program Grant Opens/Grant Closes schedule — refusing to report an empty corpus",
    );
  }
  const headings = [...region.matchAll(PROGRAM_HEADING_RE)];
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const title = stripTags(heading[1] ?? "");
    if (title.length < 3) continue;
    const blockStart = (heading.index ?? 0) + heading[0].length;
    const block = region.slice(blockStart, headings[i + 1]?.index ?? region.length);

    const openingDay = labelledDayIn(block, "Grant Opens");
    const closingDay = labelledDayIn(block, "Grant Closes");

    // The schedule paragraph's own words decide `rolling` — see the header.
    const scheduleText =
      [labelledTextIn(block, "Grant Opens"), labelledTextIn(block, "Grant Closes")]
        .filter((v): v is string => v !== null)
        .join(" ") || NOT_SPECIFIED;
    const ongoing = declaresOngoing(scheduleText);
    const infoSession = INFO_SESSION_RE.exec(block);
    const closingText = labelledTextIn(block, "Grant Closes");

    records.push({
      sourceKey: UTAH_CONNECTOR_ID,
      stateCode: "UT",
      externalId: nextId(slugify(title)),
      title,
      agency: UTAH_AGENCY,
      summary: scheduleText,
      // The programs have no page of their own — the listing IS the source page.
      url: UTAH_SOURCE_URL,
      sourceUrl: UTAH_SOURCE_URL,
      postedDate: openingDay,
      closeDate: closingDay,
      estimatedCloseDate: null,
      ongoing,
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
        // The source's own labelled VALUES, verbatim (entities decoded).
        openingText: labelledTextIn(block, "Grant Opens"),
        closingText,
        applicationDueDateText: closingText,
        openingDayPublishedBySource: openingDay,
        closingDayPublishedBySource: closingDay,
        // The information-session line that was SEEN and deliberately NOT used as
        // a deadline (it is an event, not an application deadline).
        infoSessionLine: infoSession ? stripTags(infoSession[1] ?? "") : null,
        infoSessionDayIsNeverADeadline: infoSession !== null,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: false,
        programPanelHeading: title,
        pagePublishesProgramDetail: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Utah source parsed to zero scheduled programs — the Project Grants layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyUtahRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const utahConnector: StateGrantConnector<string> = {
  id: UTAH_CONNECTOR_ID,
  stateCode: "UT",
  stateName: "Utah",
  sourceName: UTAH_SOURCE_NAME,
  agency: UTAH_AGENCY,
  sourceUrl: UTAH_SOURCE_URL,
  officialHost: UTAH_SOURCE_HOST,
  sourceValidationTest: UTAH_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: UTAH_SOURCE_URL,
      marker: UTAH_CONTENT_MARKER,
      label: "Utah",
      approvedHosts: UTAH_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseUtahGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyUtahRecord(record, now);
  },
};
