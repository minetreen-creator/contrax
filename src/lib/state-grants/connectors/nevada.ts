/**
 * NEVADA CONNECTOR — state grants NATIONWIDE workstream, continuous tranche
 * NV/OK/SC/IL (owner correction 2026-09-19, ratified 243: ONE continuous
 * workstream, ONE accumulating PR #408; source map §NV).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.nvartscouncil.org/fy27-grant-offerings/
 * WHY THIS IS OFFICIAL: it is the **Nevada Arts Council**'s own "FY27 Grant
 * Offerings" page, on the Council's own domain (`nvartscouncil.org` — the
 * discovery report's §4 allowlist decision names it explicitly, the same
 * approved-host class as `vatc.org` / `wvculture.org`). It is server-rendered
 * WordPress HTML: no key, no login, no JavaScript.
 *
 * SOURCE-CHOICE NOTE (live re-verification, 2026-09-19 — the phase-1 map's row
 * named `nvartscouncil.org/grants/`): that `/grants/` page is the Council's FAQ.
 * Fetched live on 2026-09-19 it publishes exactly ONE date in its whole body
 * ("November 29, 2023", a news post) and answers "What are the upcoming grant
 * deadlines?" with "Please review deadlines within the Guidelines that are posted
 * on the **Grant Offerings page**" — a link to the page this connector reads. The
 * FAQ is therefore NOT a dated listing and could only ever be served as all-
 * `unverified`. The Grant Offerings page it points at IS the agency's dated
 * per-program listing, on the same agency's own host, so it is the source that
 * earns the tier. The stale-fiscal-year URL is deliberate and fail-closed: when
 * the Council rolls to FY28, this page stops being the live listing and the
 * source-validation gate fails loudly instead of serving stale cycles.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's grant listing (the
 * Nevada Arts Council, a division of the Department of Tourism & Cultural
 * Affairs). Nevada publishes funding through other departments we have NOT
 * validated, so the registry reports Nevada as `limited`, never `connected`.
 *
 * WHAT THE PAGE PUBLISHES: two of its own `<h2>` sections — "Open and Upcoming
 * Grants:" and "Closed Grants:" — each holding one `<h3>` card per program, with
 * the program's own name and a list of the Council's own labelled values:
 * "Open to:", "Amount:", "Applications open:", "Application deadline:".
 *
 * HONESTY TRAPS HANDLED HERE
 *   - ONLY THE LABELLED "Application deadline:" VALUE IS A DEADLINE. The page
 *     also publishes "Grant Activity Period: July 1, 2026 – June 30, 2027" on
 *     almost every card — the period the funded *activity* runs, NOT the
 *     application deadline. That label is never read, so no activity-period date
 *     can become a closing date.
 *   - A DEADLINE RULE IS NOT A DATE. Five cards publish their deadline as a
 *     RULE ("At least 30 days before the proposed project (while funds remain
 *     available)"). It parses to no day, so those records are honestly
 *     `unverified` rather than being inferred from "while funds remain".
 *   - THE SECTION HEADING IS THE SOURCE'S OWN PAST TENSE. Cards under "Closed
 *     Grants:" publish `sourceClosed`, so a card the Council itself files as
 *     closed can never be served open even if a date on it looks future.
 *   - A PUBLISHED DEADLINE THAT HAS PASSED IS `closed`, EVEN UNDER THE "Open and
 *     Upcoming" HEADING. The Heritage Fellowship / Artist Fellowship Award cards
 *     are filed under "Open and Upcoming" while their own published deadline
 *     (May 1, 2026) has passed: the source's own dates decide, exactly as the
 *     Alabama precedent requires.
 *   - THE AWARD-RECIPIENT PAGES ARE NOT OPPORTUNITIES. `past-grantees/` and
 *     `resources-for-grant-recipients/` are award lists; the parse region ends
 *     before the page's information-session block and nothing from those pages is
 *     read (owner rule: awards and archives are never open opportunities).
 *   - The page publishes no summary/eligibility/geography/match text in a
 *     machine-labelable form beyond the labels it names ("Open to:", "Amount:"),
 *     so every other field stays NOT_SPECIFIED/empty — never inferred from prose.
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
  fetchStateGrantSource,
  officialUrl,
  publishedAmountRange,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const NEVADA_SOURCE_URL = "https://www.nvartscouncil.org/fy27-grant-offerings/";
export const NEVADA_SOURCE_HOST = "www.nvartscouncil.org";
export const NEVADA_APPROVED_HOSTS: readonly string[] = [
  "nvartscouncil.org",
  "www.nvartscouncil.org",
];
/** The publishing body, in the page's own words. */
export const NEVADA_AGENCY = "Nevada Arts Council";
export const NEVADA_SOURCE_NAME = "Nevada Arts Council — FY27 Grant Offerings";
export const NEVADA_CONNECTOR_ID = "nv-arts-council-grant-offerings";
export const NEVADA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/nevada.source-validation.test.ts";

/** The listing's own first section heading — present only on this page. */
export const NEVADA_CONTENT_MARKER = "Open and Upcoming Grants:";

/** Where the opportunity listing ends (the page's information-session block). */
export const NEVADA_REGION_END_MARKERS: readonly string[] = ["Virtual Information Sessions"];

/** The source's own heading for the programs it files as finished. */
const NEVADA_CLOSED_SECTION_MARKER = "Closed Grants:";

const CARD_SPLIT_RE = /<h3\b[^>]*class="wp-block-heading"[^>]*>/i;
const TITLE_END = "</h3>";
const GUIDELINES_LINK_RE =
  /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>\s*(?:Guidelines|Grant Guidelines)\s*<\/a>/i;
const OPEN_LABELS: readonly RegExp[] = [/\bApplications open\s*:/i, /\bApplication opens\s*:/i];
const DEADLINE_LABELS: readonly RegExp[] = [/\bApplication deadline\s*:/i];
const ELIGIBILITY_LABELS: readonly RegExp[] = [/\bOpen to\s*:/i, /\bEligibility\s*:/i];
const AMOUNT_LABELS: readonly RegExp[] = [/\bAmount\s*:/i];
/** Labels that make a paragraph a source fact rather than a description. */
const ALL_LABELS: readonly RegExp[] = [
  ...OPEN_LABELS,
  ...DEADLINE_LABELS,
  ...ELIGIBILITY_LABELS,
  ...AMOUNT_LABELS,
  /\bGrant Activity Period\s*:/i,
];

/**
 * The source's own value for one of its labels, read from the LABEL's own
 * `<li>`/`<p>`/`<br>`-delimited line. Returns the raw value (never a date) — the
 * caller decides whether it parses to a day.
 */
function labelledValue(block: string, labels: readonly RegExp[]): string | null {
  for (const segment of block.split(/<\/li>|<\/p>|<br\s*\/?>/i)) {
    const text = stripTags(segment);
    for (const label of labels) {
      const m = label.exec(text);
      if (!m) continue;
      const value = text
        .slice(m.index + m[0].length)
        .replace(/^[\s:]+/, "")
        .replace(/[\s.]+$/, "");
      if (value.length > 0) return value;
    }
  }
  return null;
}

/** Parses the FY27 Grant Offerings listing into UNCLASSIFIED records. */
export function parseNevadaGrantOfferingsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(NEVADA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Nevada source payload is not the expected FY27 Grant Offerings page (marker ${JSON.stringify(
        NEVADA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(html, NEVADA_CONTENT_MARKER, NEVADA_REGION_END_MARKERS);
  // The Council's own boundary between live and finished programs. A card AFTER
  // this offset is one the source itself files as closed.
  const closedSectionAt = region.indexOf(NEVADA_CLOSED_SECTION_MARKER);
  const cardStarts = [...region.matchAll(new RegExp(CARD_SPLIT_RE.source, "gi"))].map(
    (m) => m.index ?? 0,
  );
  const cards = cardStarts.map((start, i) => region.slice(start, cardStarts[i + 1] ?? region.length));
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const [index, card] of cards.entries()) {
    const cardStart = cardStarts[index] ?? 0;
    const titleEnd = card.indexOf(TITLE_END);
    const title = titleEnd === -1 ? "" : stripTags(card.slice(0, titleEnd));
    const body = card.slice(titleEnd === -1 ? 0 : titleEnd + TITLE_END.length);
    const deadlineValue = labelledValue(body, DEADLINE_LABELS);
    const openValue = labelledValue(body, OPEN_LABELS);
    const eligibility = labelledValue(body, ELIGIBILITY_LABELS);
    const amount = labelledValue(body, AMOUNT_LABELS);
    // A card is a program only when it names itself AND publishes at least one of
    // the source's own labelled facts. Anything else (the trailing information-
    // session headings) is skipped rather than served as a program.
    if (title.length < 3) continue;
    if (
      deadlineValue === null &&
      openValue === null &&
      eligibility === null &&
      amount === null &&
      card.search(GUIDELINES_LINK_RE) === -1
    ) {
      continue;
    }

    // The source's own words, verbatim — the ONLY inputs to status.
    const ongoing = deadlineValue !== null && declaresOngoing(deadlineValue);
    const inClosedSection = closedSectionAt !== -1 && cardStart > closedSectionAt;
    const sourceClosed =
      inClosedSection || (deadlineValue !== null && declaresClosed(deadlineValue));
    const day = ongoing || deadlineValue === null ? null : singlePublishedDay(deadlineValue);
    const openingDay = openValue === null ? null : singlePublishedDay(openValue);
    const amounts = publishedAmountRange(amount ?? "");
    const description = firstUnlabelledParagraph(body);
    const guidelinesHref = GUIDELINES_LINK_RE.exec(body)?.[1] ?? null;

    records.push({
      sourceKey: NEVADA_CONNECTOR_ID,
      stateCode: "NV",
      externalId: nextId(slugify(title)),
      title,
      agency: NEVADA_AGENCY,
      summary: description ?? NOT_SPECIFIED,
      // The program's own Guidelines page when the Agency links one on its own
      // host; the listing itself otherwise (never a third-party portal).
      url: officialUrl(guidelinesHref, {
        baseUrl: NEVADA_SOURCE_URL,
        approvedHosts: NEVADA_APPROVED_HOSTS,
        canonicalHost: NEVADA_SOURCE_HOST,
      }),
      sourceUrl: NEVADA_SOURCE_URL,
      postedDate: openingDay,
      closeDate: day,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: eligibility ?? NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: amount ?? NOT_SPECIFIED,
      awardMinAmount: amounts.min,
      awardMaxAmount: amounts.max,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        deadlineValue,
        closingText: deadlineValue,
        applicationDueDateText: deadlineValue,
        openingText: openValue,
        openingDayPublishedBySource: openingDay,
        closingDayPublishedBySource: day,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: sourceClosed,
        sectionDeclaresClosed: inClosedSection,
        // The Council's own "Grant Activity Period" is the period the funded
        // ACTIVITY runs — it is never read, so it can never become a deadline.
        grantActivityPeriodIsNeverADeadline: true,
        deadlineIsARuleWhenNoDayParsed:
          deadlineValue !== null && day === null && !ongoing && !sourceClosed,
        pagePublishesNoPerProgramDeadline: day === null,
        officialGuidelinesPageLinkedOnTheAgencysOwnHost: guidelinesHref !== null,
        declaredApplicationDeadlineDay: day !== null ? parseStateDay(day) : null,
        pagePublishesNoEligibilityOrAwardText: eligibility === null && amount === null,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Nevada source parsed to zero programs — the Grant Offerings layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The card's own one-line description, or null when it publishes none. */
function firstUnlabelledParagraph(body: string): string | null {
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1] ?? "");
    if (text.length < 8 || text.length > 220) continue;
    if (ALL_LABELS.some((label) => label.test(text))) continue;
    if (/^https?:/i.test(text)) continue;
    return text;
  }
  return null;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyNevadaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const nevadaConnector: StateGrantConnector<string> = {
  id: NEVADA_CONNECTOR_ID,
  stateCode: "NV",
  stateName: "Nevada",
  sourceName: NEVADA_SOURCE_NAME,
  agency: NEVADA_AGENCY,
  sourceUrl: NEVADA_SOURCE_URL,
  officialHost: NEVADA_SOURCE_HOST,
  sourceValidationTest: NEVADA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: NEVADA_SOURCE_URL,
      marker: NEVADA_CONTENT_MARKER,
      label: "Nevada",
      approvedHosts: NEVADA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseNevadaGrantOfferingsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyNevadaRecord(record, now);
  },
};
