/**
 * HAWAII CONNECTOR — state grants P3, batch #1 (owner rollout order 2026-09-18;
 * batch chosen, live-verified and fixture-saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded): https://sfca.hawaii.gov/grants/
 * WHY THIS IS OFFICIAL: it is published by the **Hawai'i State Foundation on
 * Culture and the Arts** (SFCA) — the state's arts agency, which names itself
 * "State Foundation on Culture and the Arts" on this page — on its own `.gov`
 * domain. It is server-rendered, needs no key, and carries a real current-cycle
 * table ("Grant Name / Grantee Specifications / Enrollment Dates"). Verified
 * live 2026-09-19 (HTTP 200); the fetched page is the saved fixture the unit
 * tests parse (`fixtures/hawaii-sfca.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW → the registry reports Hawaii as `limited`,
 * never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch source-verification report):
 *   - The page carries TWO data tables: the "Current and Upcoming Grants and
 *     Fellowships" table (`id="grant-table"`) and, below it, an **awardee** table
 *     ("FY2026 Grant Awards") that is NOT opportunities. Only the table on the
 *     `grant-table` widget is read, and the parse refuses a payload whose cycle
 *     column ("Enrollment Dates") is missing — the awardee table can never be
 *     parsed as coverage.
 *   - The cycle column mixes published dates with range wording ("Intent to Apply
 *     open August 1 - October 30, 2026. Applications open September 1 - October
 *     30, 2026"). A cell resolves to a close date only through
 *     `singlePublishedDay()`: the same closing day published twice is one closing
 *     day; several DIFFERENT days (a quarterly cycle) is unresolvable and the
 *     record stays `unverified`. Ambiguous cells are never resolved by picking
 *     one of the dates.
 *   - "closed April 30, 2026" is the source's own past-tense cycle label →
 *     `sourceClosed` → `closed` (its words win over a date).
 *   - Per-row "Grantee Specifications" is the source's own eligibility statement
 *     and is stored verbatim; nothing else (geography, categories, award, match)
 *     is published on this page, so those stay `NOT_SPECIFIED`/empty.
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
  declaresOngoing,
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
} from "~/lib/state-grants/connectors/source-support";

export const HAWAII_SOURCE_URL = "https://sfca.hawaii.gov/grants/";
export const HAWAII_SOURCE_HOST = "sfca.hawaii.gov";
export const HAWAII_APPROVED_HOSTS: readonly string[] = ["sfca.hawaii.gov"];
export const HAWAII_AGENCY = "State Foundation on Culture and the Arts";
export const HAWAII_SOURCE_NAME =
  "Hawai'i State Foundation on Culture and the Arts — Current and Upcoming Grants and Fellowships";
export const HAWAII_CONNECTOR_ID = "hi-sfca-grants";
export const HAWAII_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/hawaii.source-validation.test.ts";

/** The CURRENT-CYCLE table only (the awardee table below it is not covered). */
export const HAWAII_CONTENT_MARKER = 'id="grant-table"';

/** The cycle column, present only on the opportunities table. */
const CYCLE_COLUMN = "Enrollment Dates";

interface Row {
  title: string;
  href: string | null;
  extra: string;
  eligibility: string;
  cycle: string;
}

/** Reads the opportunities table's rows (three columns, header = `<th>`). */
function readRows(region: string): Row[] {
  const rows: Row[] = [];
  for (const m of region.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(m[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1] ?? "");
    if (cells.length < 3) continue;
    const first = cells[0] ?? "";
    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(first);
    if (!link) continue;
    const title = stripTags(link[2] ?? "");
    if (title.length < 3) continue;
    rows.push({
      title,
      href: link[1] ?? null,
      extra: stripTags(first.replace(link[0], "")),
      eligibility: stripTags(cells[1] ?? ""),
      cycle: stripTags(cells[2] ?? ""),
    });
  }
  return rows;
}

/** Parses the grants page's current-cycle table into UNCLASSIFIED records. */
export function parseHawaiiGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(HAWAII_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Hawaii source payload is not the expected grants page (marker ${JSON.stringify(
        HAWAII_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const start = html.indexOf(HAWAII_CONTENT_MARKER);
  const end = html.indexOf("</table>", start);
  if (end === -1) {
    throw new StateSourceError(
      "parse",
      "Hawaii source's current-cycle table was not closed — refusing to parse an unknown region",
    );
  }
  const region = html.slice(start, end);
  if (!region.includes(CYCLE_COLUMN)) {
    throw new StateSourceError(
      "parse",
      `Hawaii source's opportunities table no longer has its "${CYCLE_COLUMN}" column — refusing to parse (the awardee table is not coverage)`,
    );
  }
  const rows = readRows(region);
  if (rows.length === 0) {
    throw new StateSourceError(
      "parse",
      "Hawaii source parsed to zero current/upcoming grants — the table layout changed, refusing to report an empty corpus",
    );
  }

  const records: SourceGrantRecord[] = [];
  for (const row of rows) {
    const url = officialUrl(row.href, {
      baseUrl: HAWAII_SOURCE_URL,
      approvedHosts: HAWAII_APPROVED_HOSTS,
    });
    const externalId =
      externalIdFromPath(url) ?? row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    // A published closing day, or null when the cell publishes several different
    // days (see singlePublishedDay) — never a picked date.
    const closeDate = singlePublishedDay(row.cycle);
    const sourceClosed = /^closed\b/i.test(row.cycle);
    const ongoing = declaresOngoing(row.cycle);

    records.push({
      sourceKey: HAWAII_CONNECTOR_ID,
      stateCode: "HI",
      externalId,
      title: row.title,
      agency: HAWAII_AGENCY,
      summary: row.extra || NOT_SPECIFIED,
      url,
      sourceUrl: HAWAII_SOURCE_URL,
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: row.eligibility || NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        granteeSpecifications: row.eligibility,
        enrollmentDatesText: row.cycle,
        titleExtraText: row.extra,
        cycleClosedDeclaredBySource: sourceClosed,
        rollingDeclaredBySource: ongoing,
      },
    });
  }
  return records;
}

export function classifyHawaiiRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const hawaiiConnector: StateGrantConnector<string> = {
  id: HAWAII_CONNECTOR_ID,
  stateCode: "HI",
  stateName: "Hawaii",
  sourceName: HAWAII_SOURCE_NAME,
  agency: HAWAII_AGENCY,
  sourceUrl: HAWAII_SOURCE_URL,
  officialHost: HAWAII_SOURCE_HOST,
  sourceValidationTest: HAWAII_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: HAWAII_SOURCE_URL,
      marker: HAWAII_CONTENT_MARKER,
      label: "Hawaii",
    });
  },
  parse(raw: string) {
    return parseHawaiiGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyHawaiiRecord(record, now);
  },
};
