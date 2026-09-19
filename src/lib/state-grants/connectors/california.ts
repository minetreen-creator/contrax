/**
 * CALIFORNIA CONNECTOR — state grants NATIONWIDE workstream, batch 1
 * (owner nationwide order 2026-09-19; source re-scoped + verified against the raw
 * capture by the batch-1 design session; fixture saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded):
 *   https://www.grants.ca.gov/?s&status_search%5B%5D=active
 * WHY THIS IS OFFICIAL: it is the **California Grants Portal** — the State of
 * California's own grants portal, run on its `.gov` domain — and this URL is the
 * portal's OWN server-rendered *Active* results view (`status_search[]=active`),
 * not a landing page. Every grant in the response carries the portal's own
 * "Active" status word, its Deadline as a MACHINE-READABLE `<time datetime="…">`,
 * its Grantor, Eligible Applicants, Eligible Geographies and funding figures. The
 * bare `grants.ca.gov` apex redirects to this `www` host; both are approved.
 *
 * DELIBERATE DEVIATION FROM THE PHASE-1 SOURCE (recorded in the batch report):
 * phase 1 accepted the portal's LANDING page (`https://grants.ca.gov/`), which is
 * a WordPress hub with ZERO dated records. The portal's own *Active* results view
 * is the real, dated, server-rendered listing, so the connector reads THAT. The
 * covered set is page 1 of the Active facet (default sort) — not all 175 active
 * grants, and not the portal's Forecasted/Closed/Post-Award listings, which we do
 * not serve. That is why California is `limited`, never `connected`, and the
 * registry note says so.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch-1 source-verification report):
 *   - The **Open Date** cell publishes a TWO-DIGIT year ("8/24/26 13:55"). The
 *     owner's rule forbids inventing a year, and `parseStateDay` deliberately
 *     refuses two-digit years — so `postedDate` is ALWAYS null for this source and
 *     the raw text is kept for a reviewer. We never guess "2026".
 *   - The DEADLINE is read ONLY from the `<time datetime>` attribute the portal
 *     itself emits ("Mon, 21 Sep 2026 09:00:00 +0000") — the cell's own display
 *     text is also two-digit-year, and is never parsed.
 *   - The portal's own status word decides which side of the taxonomy the date
 *     lands on: "Active" is a published closing date; a hypothetical
 *     "Forecasted" status would put the date in `estimated_close_date` (never
 *     `close_date`); a "Closed"/"Post-Award" label is the source's own
 *     past-tense wording → `sourceClosed`.
 *   - `categories` stays `[]`: the portal publishes categories ONLY as facet
 *     markup / `grant_categories-*` CSS classes, and a CSS class is not a fact.
 *   - "Estimated Low/High" is the portal's own estimate column: its wording is
 *     kept in `awardRange` and its amounts become award min/max when it states
 *     them; "Dependent" states no amount, so both stay null.
 *   - Missing facts stay missing: a grant with no Purpose publishes
 *     `NOT_SPECIFIED`, not an empty string.
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
  declaresClosed,
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

/**
 * The portal's own Active-results view. The `?s&status_search%5B%5D=active` query
 * is part of the source's published URL (decoded: `?s&status_search[]=active`) —
 * hard-coded here, never built from client input.
 */
export const CALIFORNIA_SOURCE_URL =
  "https://www.grants.ca.gov/?s&status_search%5B%5D=active";
export const CALIFORNIA_SOURCE_HOST = "www.grants.ca.gov";
export const CALIFORNIA_APPROVED_HOSTS: readonly string[] = [
  "www.grants.ca.gov",
  "grants.ca.gov",
];
export const CALIFORNIA_AGENCY = "California Grants Portal";
export const CALIFORNIA_SOURCE_NAME = "California Grants Portal — Active Grants";
export const CALIFORNIA_CONNECTOR_ID = "ca-grants-portal-active";
export const CALIFORNIA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/california.source-validation.test.ts";

/** The results list's own class (absent ⇒ this is not the Active listing). */
export const CALIFORNIA_CONTENT_MARKER = 'class="grants-list__grant ';

/** The status word the portal prints in the deadline cell: "Active". */
const STATUS_RE = /<span class="status status--([a-z-]+)"[^>]*>\s*([^<]*)/i;

/** The portal's own machine-readable deadline. */
const DEADLINE_RE = /<time datetime="([^"]+)"/i;

/** "Mon, 21 Sep 2026 09:00:00 +0000" → "21 Sep 2026" → 2026-09-21. */
const RFC_DATETIME_DAY_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/;

/** The slice of one column cell / meta item, ending at the next one. */
function cellRegion(article: string, marker: string, nextMarkers: readonly string[]): string | null {
  const start = article.indexOf(marker);
  if (start === -1) return null;
  const rest = article.slice(start);
  let end = rest.length;
  for (const next of nextMarkers) {
    const idx = rest.indexOf(next, 1);
    if (idx !== -1 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}

/** A primary column's `<dd>` value, decoded and whitespace-collapsed. */
function primaryCell(article: string, column: string): string | null {
  const region = cellRegion(article, `grants-list__grant-header--${column}`, [
    "grants-list__grant-header--",
  ]);
  if (region === null) return null;
  const dd = /<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(region);
  return dd ? stripTags(dd[1] ?? "") : null;
}

/**
 * A secondary meta item's value. A `<ul>` of terms (Eligible Applicants) is
 * joined with ", " so the source's own list becomes one readable value.
 */
function metaValue(article: string, item: string): string | null {
  const region = cellRegion(article, `grant-content__meta-item--${item}`, [
    "grant-content__meta-item--",
    "</dl>",
  ]);
  if (region === null) return null;
  const dd = /<dd[^>]*>([\s\S]*?)<\/dd>/i.exec(region);
  if (!dd) return null;
  const inner = dd[1] ?? "";
  const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((li) => stripTags(li[1] ?? ""))
    .filter((v) => v.length > 0);
  return items.length > 0 ? items.join(", ") : stripTags(inner);
}

/** A secondary meta item as a stored fact: the source's own value, else "Not specified". */
function metaFact(article: string, item: string): string {
  const value = metaValue(article, item);
  return value !== null && value.length > 0 ? value : NOT_SPECIFIED;
}

/** The portal's published money text → its min/max, when it states them. */
function awardAmounts(raw: string | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const amounts = [...raw.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Number((m[1] ?? "").replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
  if (amounts.length === 0) return { min: null, max: null };
  // One amount is the ceiling the source states (CONVENTIONS.md §1); two become
  // the range it publishes.
  return amounts.length === 1
    ? { min: null, max: amounts[0]! }
    : { min: Math.min(...amounts), max: Math.max(...amounts) };
}

/** The portal's `<time datetime>` → an ISO instant, or null when unparseable. */
function isoStamp(article: string): string | null {
  const region = cellRegion(article, "grant-content__meta-item--last-updated", ["</dl>"]);
  const match = region ? DEADLINE_RE.exec(region) : null;
  if (!match) return null;
  const parsed = new Date(match[1] ?? "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Parses the Active results listing into normalised, UNCLASSIFIED records. */
export function parseCaliforniaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(CALIFORNIA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `California source payload is not the expected Active grants listing (marker ${JSON.stringify(
        CALIFORNIA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const starts = [...html.matchAll(/<article id="post-(\d+)"[^>]*>/gi)].map((m) => ({
    portalId: m[1] ?? "",
    index: m.index ?? 0,
  }));
  if (starts.length === 0) {
    throw new StateSourceError(
      "parse",
      "California source parsed to zero grant articles — the listing layout changed, refusing to report an empty corpus",
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index : html.length;
    const article = html.slice(start.index, end);

    const titleRegion = cellRegion(article, "grants-list__grant-header--grant-title", [
      "grants-list__grant-header--",
    ]);
    const link = titleRegion
      ? /<h3[^>]*class="entry-title"[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
          titleRegion,
        )
      : null;
    const title = link ? stripTags(link[2] ?? "") : "";
    if (title.length < 3) return;

    const url = officialUrl(link?.[1] ?? null, {
      baseUrl: CALIFORNIA_SOURCE_URL,
      approvedHosts: CALIFORNIA_APPROVED_HOSTS,
      canonicalHost: CALIFORNIA_SOURCE_HOST,
    });
    const externalId = nextId(externalIdFromPath(url, ["grants/"]) ?? slugify(title));

    // ── The portal's own status word and its machine-readable deadline ──────
    const deadlineRegion =
      cellRegion(article, "grants-list__grant-header--application-deadline", [
        "grants-list__grant-header--",
      ]) ?? "";
    const statusMatch = STATUS_RE.exec(deadlineRegion);
    const statusClass = (statusMatch?.[1] ?? "").toLowerCase();
    const statusLabel = stripTags(statusMatch?.[2] ?? "");
    const deadlineAttribute = DEADLINE_RE.exec(deadlineRegion)?.[1] ?? null;
    // The portal's own visible deadline text (TWO-DIGIT year — never parsed;
    // the machine-readable attribute below is the only date source).
    const deadlineText = (() => {
      const m = /<time datetime="[^"]*"[^>]*>\s*([\s\S]*?)<\/time>/i.exec(deadlineRegion);
      return m ? stripTags(m[1] ?? "") : "";
    })();
    // "Mon, 21 Sep 2026 09:00:00 +0000" → the portal's published calendar day.
    const dayText = deadlineAttribute ? (RFC_DATETIME_DAY_RE.exec(deadlineAttribute)?.[0] ?? null) : null;
    const deadlineDay = dayText ? parseStateDay(dayText) : null;
    // A forecasted cycle's date is an ESTIMATE, never a deadline (owner rule).
    const forecasted = statusClass === "forecasted" || /forecast/i.test(statusLabel);
    const closeDate = forecasted ? null : deadlineDay;
    const estimatedCloseDate = forecasted ? deadlineDay : null;

    const openDateText = (primaryCell(article, "grant-open-close") ?? "").trim();
    const agency = (primaryCell(article, "grantmaking-agency") ?? metaValue(article, "grantor") ?? "").trim();
    const awardRangeText = primaryCell(article, "estimated-award-amounts");
    const amounts = awardAmounts(awardRangeText);

    records.push({
      sourceKey: CALIFORNIA_CONNECTOR_ID,
      stateCode: "CA",
      externalId,
      title,
      agency: agency.length > 0 ? agency : CALIFORNIA_AGENCY,
      summary: metaFact(article, "purpose"),
      url,
      sourceUrl: CALIFORNIA_SOURCE_URL,
      // The Open Date cell publishes a two-digit year; refuse it rather than
      // invent "2026". The deadline comes from <time datetime> only.
      postedDate: null,
      closeDate,
      estimatedCloseDate,
      ongoing: false,
      sourceClosed: declaresClosed(statusLabel),
      sourceUpdatedAt: isoStamp(article),
      eligibleApplicants: metaFact(article, "eligible-applicants"),
      eligibleGeography: metaFact(article, "eligibility-geographic"),
      // Published only as facet markup / CSS classes — not a published fact.
      categories: [],
      awardRange: awardRangeText && awardRangeText.length > 0 ? awardRangeText : NOT_SPECIFIED,
      awardMinAmount: amounts.min,
      awardMaxAmount: amounts.max,
      totalFunding: (primaryCell(article, "total-estimated-available-funding") ?? "").trim() || NOT_SPECIFIED,
      matchingRequirement: (primaryCell(article, "eligibility-matching-funds") ?? "").trim() || NOT_SPECIFIED,
      raw: {
        portalId: start.portalId,
        sourceStatusClass: statusClass,
        sourceStatusLabel: statusLabel,
        deadlineDateTimeAttribute: deadlineAttribute,
        // The harness's date-text spot check reads this field: the portal's own
        // published deadline text (its display form, which carries a two-digit
        // year and is therefore never parsed into a date).
        applicationDeadline: deadlineText.length > 0 ? deadlineText : (deadlineAttribute ?? ""),
        publishedDeadlineDay: deadlineDay,
        // The raw Open Date cell, kept for a reviewer: TWO-DIGIT year, unparsed.
        openDateText,
        openDateUnparsedReason:
          openDateText.length > 0
            ? "the portal publishes this date with a two-digit year (e.g. 8/24/26); a year is never invented"
            : "the portal published no Open Date for this record",
        awardsEstimateWording: awardRangeText,
        grantorPublished: metaValue(article, "grantor"),
        purposePublished: metaValue(article, "purpose"),
        // The portal's own "Current as of" stamp on this record.
        lastUpdatedText: (() => {
          const region = cellRegion(article, "grant-content__meta-item--last-updated", ["</dl>"]);
          const m = region ? /<time datetime="[^"]*"[^>]*>\s*([\s\S]*?)<\/time>/i.exec(region) : null;
          return m ? stripTags(m[1] ?? "") : null;
        })(),
        categoriesPublished: false,
        firstPageOfActiveFacet: true,
      },
    });
  });

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "California source parsed to zero grants — the listing layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyCaliforniaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector the registry, the sources registry and the runner use. */
export const californiaConnector: StateGrantConnector<string> = {
  id: CALIFORNIA_CONNECTOR_ID,
  stateCode: "CA",
  stateName: "California",
  sourceName: CALIFORNIA_SOURCE_NAME,
  agency: CALIFORNIA_AGENCY,
  sourceUrl: CALIFORNIA_SOURCE_URL,
  officialHost: CALIFORNIA_SOURCE_HOST,
  sourceValidationTest: CALIFORNIA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: CALIFORNIA_SOURCE_URL,
      marker: CALIFORNIA_CONTENT_MARKER,
      label: "California",
      // The apex redirects to the canonical host; nothing else may answer.
      approvedHosts: CALIFORNIA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseCaliforniaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyCaliforniaRecord(record, now);
  },
};
