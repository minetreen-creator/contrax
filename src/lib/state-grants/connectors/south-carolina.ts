/**
 * SOUTH CAROLINA CONNECTOR — state grants NATIONWIDE workstream, continuous
 * tranche NV/OK/SC/IL (owner correction 2026-09-19, ratified 243: ONE continuous
 * workstream, ONE accumulating PR #408; source map §SC).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.southcarolinaarts.com/all-grants/
 * WHY THIS IS OFFICIAL: it is the **South Carolina Arts Commission**'s own
 * "All Grants" listing, on the Commission's own domain (`southcarolinaarts.com` —
 * the discovery report's §4 allowlist decision names it explicitly, the same
 * approved-host class as `vatc.org`). It is server-rendered WordPress HTML: no
 * key, no login, no JavaScript. (`southcarolinaarts.com/grants/` 301s to a
 * different page — `/all-grants/grants-coaching/` — so this connector hard-codes
 * the FINAL `/all-grants/` URL and allowlists the `www` host it actually serves
 * from, the Alabama precedent.)
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's grants listing (the
 * Arts Commission). South Carolina publishes funding through other departments we
 * have NOT validated, so the registry reports South Carolina as `limited`.
 *
 * WHAT THE PAGE PUBLISHES: one `<article class="grid-grant-item">` card per
 * program, each carrying the Commission's own labelled facts — "Application
 * Period" (an ordered MM/DD/YYYY - MM/DD/YYYY window), "Funding", "Matching
 * Requirement" — plus the Commission's own status badge on the card
 * (`<li class="cat-tag …">Open | Closing Soon | Closed</li>`) and a "Learn More"
 * link to that program's own page on the agency's host.
 *
 * HONESTY TRAPS HANDLED HERE — this state's whole risk is the 14 closed cards
 *   - A `Closed` BADGE IS THE SOURCE'S OWN PAST TENSE. 14 of the 19 cards carry
 *     it. Those records publish `sourceClosed`, so a card the Commission files as
 *     closed can never be served open even if a date on it looks future
 *     (CONVENTIONS.md §2 rule 1).
 *   - `Open` / `Closing Soon` ARE NEVER PROMOTED INTO A DATE. The badge is kept
 *     verbatim in `raw` and decides nothing by itself: the record's status comes
 *     from the Commission's own published application window, so an "Open"-tagged
 *     card whose published end date had passed would be served `closed` (the D.C.
 *     / Alabama stale-flag rule). No SC card is in that state today, and the test
 *     pins that the four Open/Closing-Soon cards all publish a future end date.
 *   - THE APPLICATION PERIOD IS READ AS AN ORDERED RANGE, NOT AS AN AMBIGUOUS
 *     CELL. "08/25/2026 - 03/25/2027" is the Commission's own application window:
 *     its two ends are read in source order (`publishedRangeEnds`), never picked
 *     or averaged. A card whose window is not exactly two parseable days stays
 *     honestly undated.
 *   - THE "FIVE WEEKS" RULE IS NOT A DATE. Four cards publish "Apply at least five
 *     (5) weeks before grant-funded activities begin or purchases are made." — a
 *     rule, never a deadline. It parses to no day, and those cards' real dates
 *     come from their own Application Period.
 *   - A LETTER-OF-INTENT NOTE IS NOT A DEADLINE. Two closed cards publish "This is
 *     a Letter of Intent deadline. More details in 'Deadlines & Grant Period'
 *     section." Nothing is read from that sentence.
 *   - "Matching Requirement" IS the Commission's own value ("None",
 *     "1:1 (grantee:SCAC)"), stored as published — not interpreted.
 *   - `calendly.com/scacgrantsteam/30min` (the agency's scheduling link) and other
 *     third-party hosts are never a record's URL: a record's page is its own
 *     "Learn More" page on the agency's host, else the listing.
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
  externalIdFromPath,
  fetchStateGrantSource,
  officialUrl,
  publishedAmountRange,
  publishedRangeEnds,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const SOUTH_CAROLINA_SOURCE_URL = "https://www.southcarolinaarts.com/all-grants/";
export const SOUTH_CAROLINA_SOURCE_HOST = "www.southcarolinaarts.com";
export const SOUTH_CAROLINA_APPROVED_HOSTS: readonly string[] = [
  "southcarolinaarts.com",
  "www.southcarolinaarts.com",
];
/** The publishing body, in the page's own words. */
export const SOUTH_CAROLINA_AGENCY = "South Carolina Arts Commission";
export const SOUTH_CAROLINA_SOURCE_NAME = "South Carolina Arts Commission — All Grants";
export const SOUTH_CAROLINA_CONNECTOR_ID = "sc-arts-commission-all-grants";
export const SOUTH_CAROLINA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/south-carolina.source-validation.test.ts";

/** The listing's own card class — present only on this listing. */
export const SOUTH_CAROLINA_CONTENT_MARKER = 'class="grid-grant-item"';

const CARD_RE = /<article\b[^>]*class="grid-grant-item"[^>]*>([\s\S]*?)<\/article>/gi;
const TITLE_RE = /<h3\b[^>]*class="card-title"[^>]*>([\s\S]*?)<\/h3>/i;
const BADGE_RE = /<li\b[^>]*class="cat-tag ([^"]*)"[^>]*>([\s\S]*?)<\/li>/i;
const LEARN_MORE_RE = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*class="button"/i;
/** The card's labelled facts, each a `<p class="info-header">` + its value. */
const INFO_ROW_RE =
  /<p\b[^>]*class="info-header"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/** The source's own status token → the word the Commission published. */
function cardFacts(card: string): Map<string, string> {
  const facts = new Map<string, string>();
  for (const m of card.matchAll(INFO_ROW_RE)) {
    const label = stripTags(m[1] ?? "");
    const value = stripTags(m[2] ?? "");
    if (label.length > 0 && !facts.has(label)) facts.set(label, value);
  }
  return facts;
}

/** Parses the All Grants listing into UNCLASSIFIED records. */
export function parseSouthCarolinaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(SOUTH_CAROLINA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `South Carolina source payload is not the expected All Grants listing (marker ${JSON.stringify(
        SOUTH_CAROLINA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const match of html.matchAll(CARD_RE)) {
    const card = match[1] ?? "";
    const title = stripTags(TITLE_RE.exec(card)?.[1] ?? "");
    if (title.length < 3) continue;
    const facts = cardFacts(card);
    const periodText = facts.get("Application Period") ?? null;
    const funding = facts.get("Funding") ?? null;
    const matching = facts.get("Matching Requirement") ?? null;
    const badge = BADGE_RE.exec(card);
    const badgeClass = (badge?.[1] ?? "").trim().toLowerCase();
    const badgeText = stripTags(badge?.[2] ?? "");
    // The Commission's own past-tense badge — the ONLY source-closed input.
    const sourceClosed = badgeClass === "closed";
    const range = publishedRangeEnds(periodText ?? "");
    const amounts = publishedAmountRange(funding ?? "");
    const href = LEARN_MORE_RE.exec(card)?.[1] ?? null;
    const programUrl = officialUrl(href, {
      baseUrl: SOUTH_CAROLINA_SOURCE_URL,
      approvedHosts: SOUTH_CAROLINA_APPROVED_HOSTS,
      canonicalHost: SOUTH_CAROLINA_SOURCE_HOST,
    });
    // The program's own page PATH is the Commission's identifier for it
    // (`/grant/emerging-artist-grants/` → `emerging-artist-grants`); a card whose
    // link left the allowlist falls back to its own title slug.
    const idFromPath =
      programUrl === SOUTH_CAROLINA_SOURCE_URL
        ? null
        : externalIdFromPath(programUrl, ["grant/"]);
    const deadlineNote = cardDeadlineNote(card);

    records.push({
      sourceKey: SOUTH_CAROLINA_CONNECTOR_ID,
      stateCode: "SC",
      externalId: nextId(idFromPath ?? `title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
      title,
      agency: SOUTH_CAROLINA_AGENCY,
      summary: NOT_SPECIFIED,
      url: programUrl,
      sourceUrl: SOUTH_CAROLINA_SOURCE_URL,
      postedDate: range.startDay,
      closeDate: range.endDay,
      estimatedCloseDate: null,
      // The Commission never declares a program year-round/rolling in its own
      // words, so nothing here can become `rolling` by inference.
      ongoing: false,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: funding ?? NOT_SPECIFIED,
      awardMinAmount: amounts.min,
      awardMaxAmount: amounts.max,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: matching ?? NOT_SPECIFIED,
      raw: {
        // The Commission's own badge, verbatim — it decides NOTHING by itself.
        statusBadgeText: badgeText,
        statusBadgeToken: badgeClass,
        sourceClosedDeclaredBySource: sourceClosed,
        applicationPeriodText: periodText,
        closingText: range.endDay !== null ? (range.parts[1] ?? null) : null,
        applicationDueDateText: range.parts[1] ?? null,
        openingText: range.parts[0] ?? null,
        openingDayPublishedBySource: range.startDay,
        closingDayPublishedBySource: range.endDay,
        rollingDeclaredBySource: false,
        // Two source texts on these cards are NOT deadlines, and neither is read.
        fiveWeeksRuleIsNeverADeadline: true,
        letterOfIntentNoteIsNeverADeadline: true,
        letterOfIntentNoteText: deadlineNote,
        pagePublishesAClosedBadgeOnFinishedCycles: sourceClosed,
        pagePublishesNoEligibilityOrGeographyText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "South Carolina source parsed to zero grant cards — the All Grants layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The card's own letter-of-intent sentence, when it publishes one. */
function cardDeadlineNote(card: string): string | null {
  for (const m of card.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1] ?? "");
    if (/letter of intent/i.test(text)) return text;
  }
  return null;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifySouthCarolinaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const southCarolinaConnector: StateGrantConnector<string> = {
  id: SOUTH_CAROLINA_CONNECTOR_ID,
  stateCode: "SC",
  stateName: "South Carolina",
  sourceName: SOUTH_CAROLINA_SOURCE_NAME,
  agency: SOUTH_CAROLINA_AGENCY,
  sourceUrl: SOUTH_CAROLINA_SOURCE_URL,
  officialHost: SOUTH_CAROLINA_SOURCE_HOST,
  sourceValidationTest: SOUTH_CAROLINA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: SOUTH_CAROLINA_SOURCE_URL,
      marker: SOUTH_CAROLINA_CONTENT_MARKER,
      label: "South Carolina",
      approvedHosts: SOUTH_CAROLINA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseSouthCarolinaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifySouthCarolinaRecord(record, now);
  },
};
