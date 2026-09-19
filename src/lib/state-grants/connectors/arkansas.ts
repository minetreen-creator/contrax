/**
 * ARKANSAS CONNECTOR — state grants NATIONWIDE workstream, batch 2
 * (owner nationwide order 2026-09-19; source chosen from the phase-1 discovery
 * report row AR; fixture cut from the 2026-09-19 capture).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.arkansasheritage.com/funding/art-grants
 * WHY THIS IS OFFICIAL: it is published by the **Arkansas Arts Council** — the
 * state's arts agency, a division of Arkansas Heritage (Arkansas Department of
 * Parks, Heritage & Tourism) — on the agency's own domain. `arkansasheritage.com`
 * is NOT a `.gov` domain but it IS the agency's own site: the same approved class
 * as `vatc.org` (Virginia Tourism) in the reference connector, and the discovery
 * report's §4 allowlist decision names `arkansasheritage.com` explicitly. The page
 * is server-rendered, needs no key, and names each grant program in the source's
 * own words.
 *
 * REJECTED CANDIDATES (documented, never re-proposed — discovery report row AR):
 *   - https://www.arkansasheritage.com/arkansas-arts-council/grants → HTTP 404
 *     (the path moved; the live path is /funding/art-grants).
 *   - https://www.arkansas.gov/grants → HTTP 410 Gone (the state portal no longer
 *     serves a grants path).
 *   - https://arkansasedc.com/ → HTTP 200 but a navigation hub with no dated
 *     listing (an index of links, not opportunities).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's program listing.
 * Arkansas publishes funding through other agencies we have NOT validated, so the
 * registry reports Arkansas as `limited`, never `connected`.
 *
 * WHAT THE PAGE PUBLISHES, AND WHAT IT DOES NOT
 *   The listing is a set of accordion cards ("Select your grant below"), one per
 *   program: a title, a prose description, and — where the source publishes one —
 *   the source's own status sentence ("Application Deadline Ongoing." / "This
 *   grant is currently closed for applications." / "Program is closed for this
 *   cycle."). The only links are to the Grants Portal (`grantinterface.com`),
 *   which is NOT an approved host, so every record's URL falls back to the listing.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - NO DATE IS EVER READ FROM A CARD. The cards' prose contains dates that are
 *     NOT deadlines (the Sally A. Williams card's "she passed away April 20,
 *     2010"), and a naive "parse the single day in the card" rule would turn that
 *     memorial date into a `closed` cycle. Dates on this page are published in a
 *     separate "When To Apply" list keyed by fiscal-year cycle labels that do not
 *     map one-to-one onto the card headings, so attaching one to a card would be
 *     OUR inference — refused (CONVENTIONS.md §1). Every record therefore carries
 *     `closeDate = null` and no estimate; the page still yields honest rolling and
 *     closed records from the source's own words.
 *   - "This grant is year-round and staff reviewed." (Community Arts Project) would
 *     read as rolling, but the same card's own words say it is "currently closed
 *     for applications" — the source's past-tense label wins (CONVENTIONS.md §2
 *     rule 1), so it is `closed`.
 *   - "Applications run year-round except in the month of September." is the
 *     source's own words but is NOT a declaration of continuous acceptance: it
 *     carves out a month. This connector is STRICTER than `declaresOngoing()` (the
 *     one permission CONVENTIONS.md §2 grants a connector) and refuses the rolling
 *     reading, leaving those programs `unverified` rather than claiming there is no
 *     deadline to expire.
 *   - The page's "What Types of Projects Can Be Supported?" prose and the trailing
 *     "The Arts in Education program initiates…" summary block are not programs;
 *     each card's own text stops at its APPLY link, so neither can become a record.
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
  declaresClosed,
  declaresOngoing,
  fetchStateGrantSource,
  firstHref,
  officialUrl,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const ARKANSAS_SOURCE_URL = "https://www.arkansasheritage.com/funding/art-grants";
export const ARKANSAS_SOURCE_HOST = "www.arkansasheritage.com";
export const ARKANSAS_APPROVED_HOSTS: readonly string[] = [
  "www.arkansasheritage.com",
  "arkansasheritage.com",
];
/** The publishing body, in the page's own words ("the Arkansas Arts Council's …"). */
export const ARKANSAS_AGENCY = "Arkansas Arts Council";
export const ARKANSAS_SOURCE_NAME = "Arkansas Arts Council — Art Grants";
export const ARKANSAS_CONNECTOR_ID = "ar-arkansasheritage-art-grants";
export const ARKANSAS_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/arkansas.source-validation.test.ts";

/** The listing's own instruction line (absent ⇒ this is not the page we expect). */
export const ARKANSAS_CONTENT_MARKER = "Select your grant below";

/** Where the "Select your grant below" card listing begins. */
export const ARKANSAS_LISTING_START = '<div class="accordion teamsi-accordion"';

/**
 * Where it ends: the staff block that follows the two accordions. The
 * "standard-content-block" wrappers that sit between the sections are NOT usable
 * as an end marker — one of them sits between "When To Apply" and "How To Apply"
 * and would cut the accordions off entirely.
 */
export const ARKANSAS_LISTING_END_MARKERS: readonly string[] = [
  '<h6 class="font-weight-bold mb-n1',
];

/** One card in the accordion listing. */
const ARKANSAS_CARD_MARKER = "card teamsi-accordion-card";

/**
 * A month the source carves OUT of its own "year-round" statement. When the
 * source's wording excludes a period, the program is not continuously accepting
 * applications, so this connector refuses the rolling reading (stricter than the
 * shared `declaresOngoing()`, which a connector may only tighten).
 */
const CARVED_OUT_MONTH_RE = /\bexcept (?:in|during)\b[^.]{0,40}\b(?:month|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/**
 * The card's APPLY link, wherever it is: one anonymous function reused so the
 * fallback path below cuts a card at exactly the same place the `<p>` path does.
 */
const CARD_APPLY_LINK_RE = /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?APPLY\s+(?:NOW|HERE)/i;

/**
 * Every `<p>` paragraph of a card, up to and including its APPLY link.
 *
 * THE FALLBACK (defect fixed 2026-09-19, batch 2): one real program —
 * `AIE AFTER-SCHOOL/SUMMER RESIDENCY` — publishes its card body as a bare
 * `<div>` with `<br>`s and no `<p>` at all, so a `<p>`-only reader silently
 * dropped it (the fixture parsed to 11 records instead of 12, which would have
 * understated Arkansas). When a card has NO paragraph, the card's own block text
 * up to its APPLY link is used instead — the source's words, still never a date.
 */
function cardParagraphs(cardHtml: string): string[] {
  const out: string[] = [];
  for (const m of cardHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const inner = m[1] ?? "";
    out.push(stripTags(inner));
    if (/APPLY\s+(?:NOW|HERE)/i.test(inner)) break;
  }
  const paragraphs = out.filter((p) => p.length > 0);
  if (paragraphs.length > 0) return paragraphs;
  // Start at the card BODY (never the header button, which repeats the title)
  // and stop at the APPLY link.
  const bodyStart = /<div class="card-body teamsi-accordion-body"[^>]*>/i.exec(cardHtml);
  const from = bodyStart && bodyStart.index >= 0 ? bodyStart.index + bodyStart[0].length : 0;
  const apply = CARD_APPLY_LINK_RE.exec(cardHtml.slice(from));
  const to = apply && apply.index >= 0 ? from + apply.index : cardHtml.length;
  const text = stripTags(cardHtml.slice(from, to));
  return text.length > 0 ? [text] : [];
}

/** Parses the grants listing into normalised, UNCLASSIFIED records. */
export function parseArkansasGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(ARKANSAS_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Arkansas source payload is not the expected grants page (marker ${JSON.stringify(
        ARKANSAS_CONTENT_MARKER,
      )} missing)`,
    );
  }
  if (!html.includes(ARKANSAS_LISTING_START)) {
    throw new StateSourceError(
      "parse",
      "Arkansas source no longer publishes the grants accordion listing — refusing to report an empty corpus",
    );
  }
  const region = contentRegion(html, ARKANSAS_LISTING_START, ARKANSAS_LISTING_END_MARKERS);
  const blocks = region.split(ARKANSAS_CARD_MARKER).slice(1);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const block of blocks) {
    const heading = /<h5\b[^>]*>([\s\S]*?)<\/h5>/i.exec(block);
    const title = heading ? stripTags(heading[1] ?? "") : "";
    if (title.length < 3) continue;
    const paragraphs = cardParagraphs(block);
    if (paragraphs.length === 0) continue;
    const cardText = paragraphs.join(" ");
    // The source's own status sentence, when it publishes one (kept verbatim).
    const statusText = paragraphs.find((p) => /deadline|closed|ongoing/i.test(p)) ?? null;
    const sourceClosed = declaresClosed(cardText);
    // Stricter than the shared helper: a month carved out of "year-round" is not
    // a declaration of continuous acceptance (see the header).
    const ongoing = declaresOngoing(statusText ?? cardText) && !CARVED_OUT_MONTH_RE.test(cardText);

    // The only link on a card is the Grants Portal (grantinterface.com), which is
    // not an approved host: `officialUrl` pins the record to the listing page.
    const url = officialUrl(firstHref(block), {
      baseUrl: ARKANSAS_SOURCE_URL,
      approvedHosts: ARKANSAS_APPROVED_HOSTS,
      canonicalHost: ARKANSAS_SOURCE_HOST,
    });

    records.push({
      sourceKey: ARKANSAS_CONNECTOR_ID,
      stateCode: "AR",
      externalId: nextId(slugify(title)),
      title,
      agency: ARKANSAS_AGENCY,
      summary: paragraphs[0]!,
      url,
      sourceUrl: ARKANSAS_SOURCE_URL,
      // This page publishes NO per-card deadline: see the header ("NO DATE IS EVER
      // READ FROM A CARD") — the memorial date in one card's prose proves why.
      postedDate: null,
      closeDate: null,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
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
        // Same keys + meanings the shared live harness reads.
        sourceClosedDeclaredBySource: sourceClosed,
        rollingDeclaredBySource: ongoing,
        closingText: statusText,
        pagePublishesNoPerProgramDeadline: true,
        ongoingRefusedBecauseSourceCarvesOutAMonth: CARVED_OUT_MONTH_RE.test(cardText),
        categoriesPublished: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Arkansas source parsed to zero programs — the listing layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyArkansasRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector the registry, the sources registry and the runner use. */
export const arkansasConnector: StateGrantConnector<string> = {
  id: ARKANSAS_CONNECTOR_ID,
  stateCode: "AR",
  stateName: "Arkansas",
  sourceName: ARKANSAS_SOURCE_NAME,
  agency: ARKANSAS_AGENCY,
  sourceUrl: ARKANSAS_SOURCE_URL,
  officialHost: ARKANSAS_SOURCE_HOST,
  sourceValidationTest: ARKANSAS_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: ARKANSAS_SOURCE_URL,
      marker: ARKANSAS_CONTENT_MARKER,
      label: "Arkansas",
      // The FINAL url after redirects must stay on the agency's own hosts.
      approvedHosts: ARKANSAS_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseArkansasGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyArkansasRecord(record, now);
  },
};

