/**
 * WASHINGTON CONNECTOR — state grants NATIONWIDE workstream, batch 1
 * (owner nationwide order 2026-09-19; source chosen + verified against the raw
 * capture by the batch-1 design session; fixture saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.arts.wa.gov/grants/
 * WHY THIS IS OFFICIAL: it is published by **ArtsWA** — the Washington State Arts
 * Commission, the state's arts agency — on its own `.gov` domain, it is a public
 * server-rendered page (HTTP 200, no redirect, 152 KB at capture), it needs no
 * key, and it names each program's own application cycle in the source's own
 * words ("This grant is open September 1 - October 6, 2026." / "Opens January 4,
 * 2027" / "This grant is closed."). The fetched page is the saved fixture the
 * unit tests parse (`fixtures/washington-arts.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's programs. Washington
 * publishes funding through other agencies we have NOT validated, so the registry
 * reports Washington as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch-1 source-verification report):
 *   - The page's grantee-spotlight block below the listing ("NFFTY … October 23
 *     to November 1, 2020", "7 years ago") is OUTSIDE the parsed region and can
 *     never become a record.
 *   - A window such as "This grant is open September 1 - October 6, 2026." carries
 *     ONE year-bearing day. It is the RANGE END — the source's own closing day —
 *     so it becomes `closeDate`; the year-less range START is refused
 *     (`publishedDaysIn` matches year-bearing days only), never given a year.
 *   - "Opens January 4, 2027" is an OPENING announcement. An opening date is not
 *     a deadline, so it becomes `postedDate` and the record has no close date at
 *     all — it classifies `unverified` (never "forecast", never "open").
 *   - "This grant is closed." is the source's own past-tense label →
 *     `sourceClosed` → `closed`, even though the card carries no date.
 *   - The Heritage Arts Apprenticeship Program card links to `wacultures.org`,
 *     which is NOT an ArtsWA host: the record's URL falls back to the LISTING
 *     page (CONVENTIONS.md §1) and its external id comes from the title slug, so a
 *     link off the allowlist can never send a user to an unverified page.
 *   - The page publishes no per-card description, eligibility, geography, award or
 *     match, so every one of those is `NOT_SPECIFIED`/`[]` — nothing is inferred
 *     from the page furniture around the cards.
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
  declaresClosed,
  declaresOngoing,
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const WASHINGTON_SOURCE_URL = "https://www.arts.wa.gov/grants/";
export const WASHINGTON_SOURCE_HOST = "www.arts.wa.gov";
export const WASHINGTON_APPROVED_HOSTS: readonly string[] = ["www.arts.wa.gov", "arts.wa.gov"];
/** The page names itself "ArtsWA"; the statutory name is not in its text. */
export const WASHINGTON_AGENCY = "ArtsWA";
export const WASHINGTON_SOURCE_NAME = "ArtsWA (Washington State Arts Commission) — Open and Upcoming Grants";
export const WASHINGTON_CONNECTOR_ID = "wa-arts-arts-grants";
export const WASHINGTON_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/washington.source-validation.test.ts";

/** The listing's own heading (absent ⇒ this is not the page we expect). */
export const WASHINGTON_CONTENT_MARKER = "Open and upcoming grants";

/**
 * Where the opportunity listing ends: the iconbox rows that follow it (the
 * grantee spotlight), which are NOT grants. Verified against the capture.
 */
export const WASHINGTON_REGION_END_MARKERS: readonly string[] = ["w-iconbox iconpos_top"];

/**
 * Year-bearing day fragments — the ONLY shapes that can ever become a date.
 * (Kept local so the range SEPARATOR can be located; the shared
 * `singlePublishedDay` rule still decides whether a cell resolves at all.)
 */
const YEAR_BEARING_DAY_RE =
  /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/g;

/**
 * The source's own range separator, immediately before the published day:
 * "September 1 - October 6, 2026" (en/em dashes are normalised to "-" by
 * `stripTags`). A day that follows one is the END of a published window.
 */
const RANGE_SEPARATOR_RE = /(?:-|–|—|\bto\b|\bthrough\b)\s*$/i;

/**
 * Splits a card's `<p>` text into the source's status sentence: everything after
 * the LAST "|" separator the listing prints between the title and the status.
 */
function statusSentence(pText: string): string | null {
  const sep = pText.lastIndexOf("|");
  if (sep === -1) return null;
  const rest = pText.slice(sep + 1).trim();
  return rest.length > 0 ? rest : null;
}

/**
 * The one day a card's status sentence resolves to, and WHICH side of the cycle
 * it is — the source's own wording decides, never our calendar arithmetic:
 *   - a day published after a range separator is the window's END ⇒ `closeDate`;
 *   - a lone year-bearing day (e.g. "Opens January 4, 2027") is an announcement
 *     of an OPENING ⇒ `postedDate` (an opening date is never a deadline);
 *   - no year-bearing day, or SEVERAL different ones, ⇒ both null (`unverified`).
 */
function cardDates(statusText: string): {
  postedDate: string | null;
  closeDate: string | null;
} {
  const day = singlePublishedDay(statusText);
  if (day === null) return { postedDate: null, closeDate: null };
  const matches = [...statusText.matchAll(YEAR_BEARING_DAY_RE)];
  const last = matches[matches.length - 1];
  const before = last ? statusText.slice(0, last.index ?? 0).trim() : "";
  if (RANGE_SEPARATOR_RE.test(before)) return { postedDate: null, closeDate: day };
  return { postedDate: day, closeDate: null };
}

/** Parses the grants listing into normalised, UNCLASSIFIED records. */
export function parseWashingtonGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(WASHINGTON_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Washington source payload is not the expected grants page (marker ${JSON.stringify(
        WASHINGTON_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, WASHINGTON_CONTENT_MARKER, WASHINGTON_REGION_END_MARKERS);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const block of region.matchAll(/<p>([\s\S]*?)<\/p>/gi)) {
    const cardHtml = block[1] ?? "";
    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(cardHtml);
    if (!link) continue;
    const title = stripTags(link[2] ?? "");
    if (title.length < 3) continue;
    const statusText = statusSentence(stripTags(cardHtml));
    // A card without the source's own status sentence is not a record we can
    // report honestly (the listing always prints one).
    if (statusText === null) continue;

    const url = officialUrl(link[1] ?? null, {
      baseUrl: WASHINGTON_SOURCE_URL,
      approvedHosts: WASHINGTON_APPROVED_HOSTS,
      canonicalHost: WASHINGTON_SOURCE_HOST,
    });
    // An off-allowlist link (the wacultures.org card) resolved to the listing —
    // its identity is then the title slug, never the listing's own path.
    const fromPath = url === WASHINGTON_SOURCE_URL ? null : externalIdFromPath(url);
    const externalId = nextId(fromPath ?? slugify(title));

    const { postedDate, closeDate } = cardDates(statusText);
    const sourceClosed = declaresClosed(statusText);
    const ongoing = declaresOngoing(statusText);

    records.push({
      sourceKey: WASHINGTON_CONNECTOR_ID,
      stateCode: "WA",
      externalId,
      title,
      agency: WASHINGTON_AGENCY,
      summary: NOT_SPECIFIED,
      url,
      sourceUrl: WASHINGTON_SOURCE_URL,
      postedDate,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      // The page publishes no per-record "last updated" stamp; amendment
      // detection rides on the content fingerprint (CONVENTIONS.md §3).
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
        statusText,
        // Same key + meaning as the Virginia connector, because the shared live
        // harness reads exactly this field (it must never miss a source's own
        // past-tense "closed" wording).
        sourceClosedDeclaredBySource: sourceClosed,
        rollingDeclaredBySource: ongoing,
        // The source's own window/announcement wording (the harness's date-text
        // spot check reads this field), and which side of the cycle it published.
        closingText: statusText,
        closingTextIsTheRangeEnd: closeDate !== null,
        openingDatePublishedOnly: postedDate !== null,
        listedDaysBySource: [
          ...new Set(statusText.match(YEAR_BEARING_DAY_RE) ?? []),
        ].map((d) => parseStateDay(d.replace(/(st|nd|rd|th)\b/i, ""))),
        // The page publishes no categories per card, only a filter widget.
        categoriesPublished: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Washington source parsed to zero programs — the listing layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyWashingtonRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector the registry, the sources registry and the runner use. */
export const washingtonConnector: StateGrantConnector<string> = {
  id: WASHINGTON_CONNECTOR_ID,
  stateCode: "WA",
  stateName: "Washington",
  sourceName: WASHINGTON_SOURCE_NAME,
  agency: WASHINGTON_AGENCY,
  sourceUrl: WASHINGTON_SOURCE_URL,
  officialHost: WASHINGTON_SOURCE_HOST,
  sourceValidationTest: WASHINGTON_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: WASHINGTON_SOURCE_URL,
      marker: WASHINGTON_CONTENT_MARKER,
      label: "Washington",
      // The FINAL url after redirects must stay on ArtsWA's own hosts.
      approvedHosts: WASHINGTON_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseWashingtonGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyWashingtonRecord(record, now);
  },
};
