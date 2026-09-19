/**
 * ILLINOIS CONNECTOR — state grants NATIONWIDE workstream, continuous tranche
 * NV/OK/SC/IL (owner correction 2026-09-19, ratified 243: ONE continuous
 * workstream, ONE accumulating PR #408; source map §IL).
 *
 * THE FIRST BUILD TASK WAS TO FIND THE DATED LISTING, and this is it:
 *   https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx
 * The source map recorded that GATA's dated NOFO path was NOT located (the
 * guessed `/csfa/` and `/nofo.html` both 404) and that the `gata.illinois.gov`
 * root is an informational page, NOT the dated list — so claiming a tier off the
 * root was forbidden. Located live on 2026-09-19 by following the site's own link
 * graph: `gata.illinois.gov` root → its own "CSFA link" `/grants/csfa.html` →
 * that page's embedded public CSFA application (`https://omb.illinois.gov/public/
 * gata/csfa/`, the "Browse active programs / current funding opportunities"
 * system) → its own "Click here to browse a list of current funding opportunities"
 * link → **OpportunityList.aspx**. Every hop is the State of Illinois' own
 * `.gov` estate; the CSVF/CSFA is required by the Grants Accountability and
 * Transparency Act (30 ILCS 708) to be "a single, authoritative, statewide,
 * comprehensive source" of State financial assistance information.
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx
 * It is server-rendered ASP.NET HTML with the whole current-opportunity table in
 * the initial response and NO pagination (the page states its own total:
 * "Opportunities: 121" on 2026-09-19): no key, no login, no JavaScript, no
 * vendor API. (`gata.illinois.gov/grants/csfa.html` is a shell that embeds the
 * CSFA app in an iframe, so the app itself is the source.)
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW HERE — and Illinois is the one state in this
 * tranche where `curated` was *plausible* (it is one of the four designated
 * multi-agency portals): the CSFA is a statewide hub, but this connector reads
 * ONE view of it — the current funding-opportunity list — with no per-program
 * eligibility/geography/detail, and we have NOT validated the Illinois Arts
 * Council or any other agency's own listing. It therefore declares `limited`,
 * never `curated`/`connected`.
 *
 * WHAT THE PAGE PUBLISHES: one `<tr>` per opportunity with four of its own
 * columns — "Opportunity Title", "Agency", "Application Date Range", "Award
 * Range" — and, on most rows, the system's own `GMS` marker plus a link
 * (`GMS.aspx?url=…`, or `Opportunity.aspx?nofo=<id>` where the State hosts the
 * notice itself).
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE "Application Date Range" COLUMN IS AN ORDERED WINDOW. Its two ends are
 *     read in source order by `publishedRangeEnds` (start ⇒ opening, end ⇒
 *     closing); nothing is picked, averaged or inferred. A row whose range is not
 *     exactly two parseable days stays honestly undated.
 *   - THE SOURCE'S OWN "No end date" IS THE ONLY WAY A ROW IS `rolling`. 61 of
 *     the 121 rows publish "MM/DD/YYYY - No end date". That token is the source's
 *     own declaration that the window has no end, so those records are `rolling`
 *     with NO close date — never an invented deadline.
 *   - A PASSED WINDOW IS `closed`. Rows whose published end date has gone by are
 *     served `closed`; the list is the State's *current* opportunity list, but the
 *     State's own dates decide what is open (the Alabama rule), so nothing is
 *     served open merely because the page is live.
 *   - "Not Applicable" AWARD RANGE IS NOT A NUMBER. Five rows publish it; the
 *     award fields stay NOT_SPECIFIED (the wording is kept in `raw`), so a
 *     "$0 - $0" row and a "not stated" row can never be confused. Where the
 *     column DOES publish amounts, only the State's own figures are stored.
 *   - THE `GMS` LINK IS THE STATE'S OWN DOOR TO A VENDOR-DETAIL NOFO. The row's
 *     link is read only from the State's own host and pinned through the approved
 *     allowlist, so a record's URL can never leave `omb.illinois.gov` even though
 *     the row forwards to the State's grant-management front end.
 *   - The page publishes no eligibility/geography/category text in a machine-
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
  decodeEntities,
  fetchStateGrantSource,
  officialUrl,
  publishedAmountRange,
  publishedRangeEnds,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const ILLINOIS_SOURCE_URL =
  "https://omb.illinois.gov/public/gata/csfa/OpportunityList.aspx";
export const ILLINOIS_SOURCE_HOST = "omb.illinois.gov";
export const ILLINOIS_APPROVED_HOSTS: readonly string[] = [
  "omb.illinois.gov",
  "www.omb.illinois.gov",
];
/** The publishing body, in the page's own words. */
/**
 * The publishing body, in the listing's OWN words. The CSFA page carries its own
 * banner token ("GATA") and nothing longer, so the agency label is exactly that
 * literal — the shared live harness asserts the agency name really appears in the
 * live page text, and an invented long-form label would fail that gate. The full
 * name lives in `sourceName` and in the registry note.
 */
export const ILLINOIS_AGENCY = "GATA";
export const ILLINOIS_SOURCE_NAME =
  "Illinois CSFA — Current Funding Opportunities (OpportunityList)";
export const ILLINOIS_CONNECTOR_ID = "il-gata-csfa-opportunities";
export const ILLINOIS_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/illinois.source-validation.test.ts";

/** The table's own column header — present only on this listing. */
export const ILLINOIS_CONTENT_MARKER = "Application Date Range";
/** Where the row list begins (the table's own header row). */
export const ILLINOIS_REGION_START_MARKER = "<th>Opportunity Title</th>";

const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const CELL0_LINK_RE = /<a\b[^>]*href\s*=\s*'([^']+)'[^>]*>([\s\S]*?)<\/a>/i;
const AMPLIFUND_DETAIL_RE =
  /https?:\/\/[^/]*amplifund\.com\/Public\/Opportunities\/Details\/([0-9a-f-]{8,})/i;
const NOFO_ID_RE = /[?&]nofo=([A-Za-z0-9_-]+)/;

/**
 * The State's own identifier for a row, in its own terms: the `nofo=` id where the
 * State hosts the notice, the grant-management detail GUID where the link forwards
 * to it, and only then the title. Stable across runs and never positional
 * (CONVENTIONS.md §3).
 */
function externalIdFor(title: string, href: string | null): string {
  const nofo = href === null ? null : NOFO_ID_RE.exec(href)?.[1];
  if (nofo) return `nofo-${nofo.toLowerCase()}`;
  // The GMS rows encode the State's grant-management detail URL
  // (`GMS.aspx?url=https%3a%2f%2fil.amplifund.com%2f…`), so the href must be
  // percent-decoded before the State's own detail GUID can be read off it.
  const decoded = href === null ? null : decodeURIComponentSafe(decodeEntities(href));
  const guid = decoded === null ? null : AMPLIFUND_DETAIL_RE.exec(decoded)?.[1];
  if (guid) return `gms-${guid.toLowerCase()}`;
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** `decodeURIComponent` that refuses to throw on a malformed source href. */
function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parses the CSFA current-opportunity table into UNCLASSIFIED records. */
export function parseIllinoisOpportunityList(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(ILLINOIS_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Illinois source payload is not the expected CSFA OpportunityList (marker ${JSON.stringify(
        ILLINOIS_CONTENT_MARKER,
      )} missing)`,
    );
  }
  if (!html.includes(ILLINOIS_REGION_START_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Illinois CSFA OpportunityList no longer publishes its own table header (${JSON.stringify(
        ILLINOIS_REGION_START_MARKER,
      )} missing) — refusing to guess at the listing's shape`,
    );
  }
  const regionAt = html.indexOf(ILLINOIS_REGION_START_MARKER);
  const region = html.slice(regionAt);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const row of region.matchAll(ROW_RE)) {
    const cells = [...(row[1] ?? "").matchAll(CELL_RE)].map((c) => c[1] ?? "");
    // The table's own shape: 4 columns per opportunity. A row with a different
    // shape is not an opportunity row (header/nav/footer) and is skipped.
    if (cells.length < 4) continue;
    const [titleCell, agencyCell, rangeCell, awardCell] = cells as [string, string, string, string];
    const link = CELL0_LINK_RE.exec(titleCell);
    const href = link?.[1] ?? null;
    const title = stripTags(link?.[2] ?? titleCell);
    const agency = stripTags(agencyCell);
    const rangeText = stripTags(rangeCell);
    const awardText = stripTags(awardCell);
    if (title.length < 3) continue;
    // The State's own "No end date" / two-day window is the ONLY date input.
    const range = publishedRangeEnds(rangeText);
    if (range.parts.length !== 2 && range.startDay === null) continue;

    const ongoing = range.openEnded;
    const amounts = publishedAmountRange(awardText);
    const awardStated = awardText.length > 0 && !/^not applicable$/i.test(awardText);

    records.push({
      sourceKey: ILLINOIS_CONNECTOR_ID,
      stateCode: "IL",
      externalId: nextId(externalIdFor(title, href)),
      title,
      // The row's own Agency column is the State's own value for the publishing
      // body ("AGE (402)"), kept verbatim; the CSFA is the source.
      agency: agency.length > 0 ? agency : ILLINOIS_AGENCY,
      summary: NOT_SPECIFIED,
      url: officialUrl(href, {
        baseUrl: ILLINOIS_SOURCE_URL,
        approvedHosts: ILLINOIS_APPROVED_HOSTS,
        canonicalHost: ILLINOIS_SOURCE_HOST,
      }),
      sourceUrl: ILLINOIS_SOURCE_URL,
      postedDate: range.startDay,
      closeDate: range.endDay,
      estimatedCloseDate: null,
      ongoing,
      // The State's table carries no past-tense "closed" token: a row is closed
      // only because its own published end date has passed (classifier rule 5).
      sourceClosed: false,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: awardStated ? awardText : NOT_SPECIFIED,
      awardMinAmount: awardStated ? amounts.min : null,
      awardMaxAmount: awardStated ? amounts.max : null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        applicationDateRange: rangeText,
        openingText: range.parts[0] ?? null,
        closingText: range.openEnded ? null : (range.parts[1] ?? null),
        applicationDueDateText: range.openEnded ? null : (range.parts[1] ?? null),
        // The State's own wording, verbatim — the ONLY rolling input.
        noEndDateDeclaredBySource: range.openEnded,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: false,
        openingDayPublishedBySource: range.startDay,
        closingDayPublishedBySource: range.endDay,
        awardRangeText: awardText,
        awardRangeStatedAsNotApplicable: !awardStated,
        agencyColumn: agency,
        rowLinkIsTheStatesOwnDoorOnItsOwnHost: href !== null,
        pagePublishesTheWholeListWithoutPagination: true,
        pagePublishesNoEligibilityOrGeographyText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Illinois CSFA OpportunityList parsed to zero opportunities — the table changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyIllinoisRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const illinoisConnector: StateGrantConnector<string> = {
  id: ILLINOIS_CONNECTOR_ID,
  stateCode: "IL",
  stateName: "Illinois",
  sourceName: ILLINOIS_SOURCE_NAME,
  agency: ILLINOIS_AGENCY,
  sourceUrl: ILLINOIS_SOURCE_URL,
  officialHost: ILLINOIS_SOURCE_HOST,
  sourceValidationTest: ILLINOIS_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: ILLINOIS_SOURCE_URL,
      marker: ILLINOIS_CONTENT_MARKER,
      label: "Illinois",
      approvedHosts: ILLINOIS_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseIllinoisOpportunityList(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyIllinoisRecord(record, now);
  },
};
