/**
 * ALABAMA CONNECTOR — state grants NATIONWIDE workstream, tranche DC/WV/KY/AL/ME
 * (owner nationwide order 2026-09-19; source map §AL).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://adeca.alabama.gov/about/funding-opportunities/
 * WHY THIS IS OFFICIAL: it is **ADECA** (the Alabama Department of Economic and
 * Community Affairs — the state's grant-administering agency) on its own `.gov`
 * domain, on the page it publishes for "funding opportunities, requests for
 * proposals, requests for applications, and other grant opportunities". It is
 * server-rendered WordPress HTML, needs no key, no login and no JavaScript.
 *
 * THE REDIRECT IS HARD-CODED AWAY. The address the discovery sweep recorded,
 * `/funding-opportunities/`, answers 301 and lands on `/about/funding-opportunities/`.
 * The connector therefore hard-codes the FINAL URL and puts ONLY the final host on
 * the allowlist, because `fetchStateGrantSource()` refuses to parse a listing
 * whose final URL left the approved hosts (the IA/AL rule in the source map §4).
 *
 * REJECTED CANDIDATES (documented; never re-proposed as the source — source map §5):
 *   - `southarts.org` (ranked #1 in Alabama's first-pass shortlist) — a regional
 *     non-profit arts organisation, not a state agency.
 *   - `verdantfund.org` — a private foundation.
 *   - `grantinterface.com` — a THIRD-PARTY grant portal the state's arts council
 *     happens to use; the portal is a vendor host, not the agency's own listing.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's listing (ADECA's own
 * programs). Alabama publishes funding through other departments we have NOT
 * validated, so the registry reports Alabama as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE DEADLINE IS READ ONLY FROM THE SOURCE'S OWN LABEL OR ITS OWN DEADLINE
 *     SENTENCE. Most programs publish "Application Deadline: <date>"; the VW
 *     Settlement program publishes its closing in prose — "We are now accepting
 *     applications until **October 6, 2026, 11:59 p.m. Central**" — and only that
 *     explicit "accepting applications until" phrase is read.
 *   - A WORKSHOP IS AN EVENT, NOT A DEADLINE. The same VW paragraph publishes a
 *     dated application workshop ("an application workshop webinar, *Tuesday,
 *     September 1, 2026 at 1:30 p.m.*"). It is kept verbatim in `raw` as the
 *     event it is, is NEVER used as a date, and cannot leak into a closing date
 *     because the deadline is read from the "accepting applications until" value
 *     on its own.
 *   - A PAGE THAT SAYS "currently open … only" STILL OBEYS ITS OWN DATES. ADECA's
 *     intro says the page lists currently open opportunities only, yet two of the
 *     published deadlines (September 18, 2026) had passed when this connector was
 *     written. Those records are reported `closed` — the date the source itself
 *     published beats the page's own category header, and nothing is ever shown as
 *     open because a listing is stale. The other two (September 25 and October 6,
 *     2026) are `open`.
 *   - Division headings (`<h3>`, e.g. "Law Enforcement and Traffic Safety") are NOT
 *     programs and never become records: only the `<h4>` program blocks do.
 *   - The page publishes no structured eligibility / geography / award / match
 *     values, so those fields stay NOT_SPECIFIED/empty — nothing inferred.
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
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const ALABAMA_SOURCE_URL = "https://adeca.alabama.gov/about/funding-opportunities/";
export const ALABAMA_SOURCE_HOST = "adeca.alabama.gov";
export const ALABAMA_APPROVED_HOSTS: readonly string[] = [
  "adeca.alabama.gov",
  "www.adeca.alabama.gov",
];
export const ALABAMA_AGENCY = "Alabama Department of Economic and Community Affairs";
export const ALABAMA_SOURCE_NAME = "ADECA — Funding Opportunities";
export const ALABAMA_CONNECTOR_ID = "al-adeca-funding-opportunities";
export const ALABAMA_SOURCE_VALIDATION_TEST = "src/lib/state-grants/alabama.source-validation.test.ts";

/**
 * The listing's own sentence, anchored to the `<p>` it is published in.
 * The bare sentence ALSO appears in this page's `<meta property="og:description">`
 * head tag, so a bare-text marker would start the parse region inside `<head>` and
 * pull the page's introductory `<h4>` in as if it were a program (observed: five
 * records instead of four). Anchoring on `<p>` keeps the region in the listing.
 */
export const ALABAMA_CONTENT_MARKER = "<p>This page lists currently open opportunities only.";

/** Where the opportunity listing ends. */
export const ALABAMA_REGION_END_MARKERS: readonly string[] = ["See the ADECA Grant Calendar"];

/** Program blocks. The division headings are `<h3>` and are deliberately skipped. */
const PROGRAM_HEADING_RE = /<h4\b[^>]*>([\s\S]*?)<\/h4>/gi;
/** The source's own label for the closing day. */
const DEADLINE_LABEL_RE = /\bApplication Deadline\s*:/i;
/** The VW Settlement program's own deadline sentence (no label). */
const UNTIL_PHRASE_RE = /\baccepting applications until\b/i;
/** A dated workshop/webinar on the same page — an EVENT, never a deadline. */
const WEBINAR_RE = /webinar,\s*<em>([\s\S]*?)<\/em>/i;
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
/** A downloadable document, not a page of its own. */
const DOCUMENT_HREF_RE = /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|#|$)/i;

/**
 * The opportunity's own page, when ADECA publishes one. Most of this listing's
 * links are downloadable applications/announcements (PDF, DOCX, XLSX), which are
 * documents rather than a page a reader can be sent to — for those the listing
 * itself is the record's source, exactly as the Utah and West Virginia connectors
 * do. An off-host or document-only card therefore keeps the listing URL.
 */
function programPageUrl(block: string): string {
  // Only links the source publishes BEFORE the deadline value are considered: a
  // link that belongs to a later block on the page (e.g. the grant calendar) is
  // not this program's page.
  const cut = block.split(/\bApplication Deadline\s*:|\baccepting applications until\b/i)[0] ?? block;
  for (const m of cut.matchAll(/<a\b[^>]*href\s*=\s*"([^"]+)"/gi)) {
    const href = m[1] ?? "";
    if (DOCUMENT_HREF_RE.test(href)) continue;
    const resolved = officialUrl(href, {
      baseUrl: ALABAMA_SOURCE_URL,
      approvedHosts: ALABAMA_APPROVED_HOSTS,
      canonicalHost: ALABAMA_SOURCE_HOST,
    });
    if (resolved !== ALABAMA_SOURCE_URL) return resolved;
  }
  return ALABAMA_SOURCE_URL;
}

/**
 * The source's own value after a label: the `<strong>` element the page wraps it
 * in. When a future revision drops the `<strong>`, the fallback reads only the
 * text between the label and the end of its own line — bounded, so a later
 * sentence's date can never be pulled in.
 */
function labelledValue(block: string, labelRe: RegExp): string | null {
  const at = block.search(labelRe);
  if (at === -1) return null;
  const tail = block.slice(at);
  const strong = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(tail);
  if (strong) {
    const text = stripTags(strong[1] ?? "").trim();
    if (text.length > 0) return text;
  }
  const beforeBreak = tail.split(/<br\s*\/?>|<\/p>/i)[0] ?? "";
  const text = stripTags(beforeBreak).trim();
  return text.length > 0 ? text : null;
}

/** Parses ADECA's funding-opportunities listing into UNCLASSIFIED records. */
export function parseAlabamaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(ALABAMA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Alabama source payload is not the expected ADECA Funding Opportunities page (marker ${JSON.stringify(
        ALABAMA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, ALABAMA_CONTENT_MARKER, ALABAMA_REGION_END_MARKERS);
  const headings = [...region.matchAll(PROGRAM_HEADING_RE)];
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const title = stripTags(heading[1] ?? "");
    if (title.length < 3) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const block = region.slice(start, headings[i + 1]?.index ?? region.length);

    // Prefer the source's own label; the VW Settlement program publishes its
    // closing in its own words instead.
    const labelled = labelledValue(block, DEADLINE_LABEL_RE);
    const until = labelled === null ? labelledValue(block, UNTIL_PHRASE_RE) : null;
    const deadlineText = labelled ?? until;
    const closeDate = deadlineText === null ? null : singlePublishedDay(deadlineText);
    const webinar = WEBINAR_RE.exec(block);

    // The description is prose the source wrote — never a paragraph that is only
    // a list of document links (those carry a file name, not a description).
    const summary = [...block.matchAll(PARAGRAPH_RE)]
      .map((m) => ({ raw: m[1] ?? "", text: stripTags(m[1] ?? "") }))
      .find((p) =>
        p.text.length > 40 &&
        !DEADLINE_LABEL_RE.test(p.text) &&
        stripTags(p.raw.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")).length >= 10
      )?.text ?? "";

    records.push({
      sourceKey: ALABAMA_CONNECTOR_ID,
      stateCode: "AL",
      externalId: nextId(slugify(title)),
      title,
      agency: ALABAMA_AGENCY,
      summary: summary.length > 0 ? summary : NOT_SPECIFIED,
      url: programPageUrl(block),
      sourceUrl: ALABAMA_SOURCE_URL,
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      // The page never declares a program year-round/rolling.
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
        deadlineValue: deadlineText,
        closingText: deadlineText,
        applicationDueDateText: deadlineText,
        deadlineReadFromTheApplicationDeadlineLabel: labelled !== null,
        deadlineReadFromTheSourcesAcceptingApplicationsUntilPhrase: until !== null,
        closingDayPublishedBySource: closeDate,
        // The dated workshop on this page is an EVENT: kept verbatim, never a date.
        webinarLine: webinar ? stripTags(webinar[1] ?? "") : null,
        webinarDayIsNeverADeadline: webinar !== null,
        rollingDeclaredBySource: false,
        sourceClosedDeclaredBySource: false,
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Alabama source parsed to zero programs — the ADECA listing changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyAlabamaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const alabamaConnector: StateGrantConnector<string> = {
  id: ALABAMA_CONNECTOR_ID,
  stateCode: "AL",
  stateName: "Alabama",
  sourceName: ALABAMA_SOURCE_NAME,
  agency: ALABAMA_AGENCY,
  sourceUrl: ALABAMA_SOURCE_URL,
  officialHost: ALABAMA_SOURCE_HOST,
  sourceValidationTest: ALABAMA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: ALABAMA_SOURCE_URL,
      marker: ALABAMA_CONTENT_MARKER,
      label: "Alabama",
      approvedHosts: ALABAMA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseAlabamaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyAlabamaRecord(record, now);
  },
};
