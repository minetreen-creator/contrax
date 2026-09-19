/**
 * COLORADO CONNECTOR — state grants NATIONWIDE workstream, batch 2
 * (owner nationwide order 2026-09-19; source chosen from the phase-1 discovery
 * report row CO and re-verified against the raw capture by the batch-2 design
 * session; fixture cut from the 2026-09-19 capture).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://oedit.colorado.gov/advanced-industries-accelerator-programs
 * WHY THIS IS OFFICIAL: it is published by the **Colorado Office of Economic
 * Development and International Trade** (OEDIT) — a state agency — on its own
 * `.gov` domain. It is server-rendered (Drupal), needs no key, and lists the
 * Advanced Industries Accelerator program family with the division's own
 * per-program application wording ("The application is open and due August 27,
 * 2026 at 5pm MT."). The page that `/advanced-industries` redirects to is this
 * one (HTTP 200, no further redirect at capture); the captured page is the saved
 * fixture the unit tests parse (`fixtures/colorado-oedit-ai-programs.html`).
 *
 * THE CANDIDATE THAT WAS REJECTED (documented, never re-proposed):
 *   - https://oedit.colorado.gov/programs-and-funding — a facet-driven program
 *     DIRECTORY with ZERO date tokens and zero "deadline" mentions, so it can
 *     never yield an honest dated record. The child pages below DO publish dates,
 *     and the accelerator-programs page is the one listing-shaped page that
 *     carries several of them without a per-program fetch. Also rejected as 404s:
 *     /grants, /programs-and-funding/grants, /arts-for-all-2030-colorado-creative-industries.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE program family of ONE OEDIT
 * division. Colorado publishes funding through many other agencies we have NOT
 * validated, and the OEDIT Programs-and-Funding index publishes no per-program
 * dates at all, so the registry reports Colorado as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - The page's "Overview" block ("Type: Four grants / For: … / Application
 *     deadline: Varies by program") is NOT a program. The region is split on
 *     `<h4>` — the heading that starts each program block — so the Overview
 *     (`<h3>`) can never become a record, and neither can the page furniture
 *     around the cards.
 *   - A published day only becomes `closeDate` when the block's OWN words label
 *     it as a closing ("due" / "deadline"). Other real dates on the page (for
 *     example "The next application will open February 1, 2027") are openings,
 *     not deadlines: they are kept verbatim in `raw` and stay out of BOTH date
 *     columns, so an opening announcement is never shown as a cycle we can
 *     confirm is accepting applications.
 *   - "This grant is accepting applications." is NOT a declaration of continuous
 *     acceptance (no rolling/year-round wording), so those programs are
 *     `unverified` rather than `rolling` — the connector never loosens the
 *     shared `declaresOngoing()` rule.
 *   - The page publishes no eligibility, geography, award or match on these
 *     blocks, so every one of those stays `NOT_SPECIFIED`/empty — nothing is
 *     inferred from the surrounding page furniture.
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
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const COLORADO_SOURCE_URL =
  "https://oedit.colorado.gov/advanced-industries-accelerator-programs";
export const COLORADO_SOURCE_HOST = "oedit.colorado.gov";
export const COLORADO_APPROVED_HOSTS: readonly string[] = [
  "oedit.colorado.gov",
  "www.oedit.colorado.gov",
];
export const COLORADO_AGENCY = "Colorado Office of Economic Development and International Trade";
export const COLORADO_SOURCE_NAME =
  "Colorado Office of Economic Development and International Trade — Advanced Industries Accelerator Programs";
export const COLORADO_CONNECTOR_ID = "co-oedit-advanced-industries";
export const COLORADO_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/colorado.source-validation.test.ts";

/** The listing's own heading — present only on the accelerator-programs page. */
export const COLORADO_CONTENT_MARKER =
  "<h2>Advanced Industries Accelerator Programs</h2>";

/**
 * Where the program listing ends: the staff h2 that follows the OEDIT cards.
 * (On the trimmed fixture this marker is already the slice boundary, so the
 * region simply runs to the end — the behaviour is identical.)
 */
export const COLORADO_REGION_END_MARKERS: readonly string[] = ["Program Manager"];

/**
 * The heading that starts each program block. It is matched WITH its heading
 * text, because the block's title lives INSIDE the `<h4>`: splitting the region
 * on the opening tag alone would throw the title away with the delimiter and
 * every block would then be discarded as untitled.
 */
const COLORADO_BLOCK_HEADING_RE = /<h4\b[^>]*>([\s\S]*?)<\/h4>/gi;

/** The block's own words must label the day as a CLOSING, not an opening. */
const CLOSING_LABEL_RE = /\b(?:due|deadline)\b/i;

/** Parses the accelerator-programs listing into UNCLASSIFIED records. */
export function parseColoradoGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(COLORADO_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Colorado source payload is not the expected accelerator-programs page (marker ${JSON.stringify(
        COLORADO_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, COLORADO_CONTENT_MARKER, COLORADO_REGION_END_MARKERS);
  // Walking the PROGRAM headings excludes the Overview block, which is an `<h3>`
  // and therefore can never become a record (see the header).
  const headings = [...region.matchAll(COLORADO_BLOCK_HEADING_RE)];
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const title = stripTags(heading[1] ?? "");
    if (title.length < 3) continue;
    // The block runs from the end of its own heading to the next heading (or the
    // end of the region) — so the title is never consumed as a delimiter.
    const blockStart = (heading.index ?? 0) + heading[0].length;
    const block = region.slice(blockStart, headings[i + 1]?.index ?? region.length);
    const body = stripTags(block);
    if (body.length === 0) continue;

    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const url = officialUrl(link ? link[1] : null, {
      baseUrl: COLORADO_SOURCE_URL,
      approvedHosts: COLORADO_APPROVED_HOSTS,
      canonicalHost: COLORADO_SOURCE_HOST,
    });
    const fromPath = url === COLORADO_SOURCE_URL ? null : externalIdFromPath(url);
    const externalId = nextId(fromPath ?? slugify(title));

    // A day is a deadline ONLY when the block's own words say so; a published
    // opening announcement stays out of both date columns (kept in `raw`).
    const labelled = CLOSING_LABEL_RE.test(body);
    const publishedDay = singlePublishedDay(body);
    const closeDate = labelled ? publishedDay : null;
    const closingSentence =
      body.split(/(?<=\.)\s/).find((s) => CLOSING_LABEL_RE.test(s)) ?? null;
    const ongoing = declaresOngoing(body);

    records.push({
      sourceKey: COLORADO_CONNECTOR_ID,
      stateCode: "CO",
      externalId,
      title,
      agency: COLORADO_AGENCY,
      summary: body.split(/(?<=\.)\s/)[0] ?? NOT_SPECIFIED,
      url,
      sourceUrl: COLORADO_SOURCE_URL,
      postedDate: null,
      closeDate,
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
        // The source's own closest status wording, kept verbatim.
        closingText: closingSentence,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: false,
        // The day the block publishes, whether or not it is a closing: a day
        // published only as an ANNOUNCEMENT (an opening) is recorded here and
        // deliberately kept out of close_date/posted_date.
        publishedDayNotUsedAsADeadline: closeDate === null ? publishedDay : null,
        announcedOpeningOnly: closeDate === null && publishedDay !== null,
        blockPublishesAClosingLabel: labelled,
        programFamily: "Advanced Industries Accelerator Programs",
        categoriesPublished: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Colorado source parsed to zero programs — the listing layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyColoradoRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const coloradoConnector: StateGrantConnector<string> = {
  id: COLORADO_CONNECTOR_ID,
  stateCode: "CO",
  stateName: "Colorado",
  sourceName: COLORADO_SOURCE_NAME,
  agency: COLORADO_AGENCY,
  sourceUrl: COLORADO_SOURCE_URL,
  officialHost: COLORADO_SOURCE_HOST,
  sourceValidationTest: COLORADO_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: COLORADO_SOURCE_URL,
      marker: COLORADO_CONTENT_MARKER,
      label: "Colorado",
      approvedHosts: COLORADO_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseColoradoGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyColoradoRecord(record, now);
  },
};
