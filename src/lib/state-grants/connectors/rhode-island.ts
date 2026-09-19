/**
 * RHODE ISLAND CONNECTOR — state grants P3, batch #1 (owner rollout order
 * 2026-09-18; batch chosen, live-verified and fixture-saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded): https://www.arts.ri.gov/grants/
 * WHY THIS IS OFFICIAL: it is the **Rhode Island State Council on the Arts**
 * (RISCA), the state's arts agency, publishing "Our Grants" on its own `.gov`
 * domain; it is server-rendered; it groups every program under the source's OWN
 * cycle declaration (`Currently Open` / `Opening Feb. 1` / `Opening this Summer`
 * / `Currently Closed`); and it needs no key. Verified live 2026-09-19 (HTTP 200,
 * 15 program cards across those four groups); the fetched page is the saved
 * fixture the unit tests parse (`fixtures/rhode-island-risca.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW → the registry reports Rhode Island as
 * `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (the most important ones in this batch):
 *   - RISCA's in-card dates are YEAR-LESS: "Opens: Feb. 1. Deadline: April 1.",
 *     "Rolling Deadlines. Opens Aug. 3." `parseStateDay` refuses a date with no
 *     year, so those records are honestly `unverified` — a year is NEVER
 *     invented to make them look open or upcoming. This is the deliberate,
 *     honest outcome for this source, not a parsing failure.
 *   - The "Currently Closed" heading IS the source's own past-tense declaration
 *     about those programs, so it sets `sourceClosed` → `closed`. No other
 *     heading is used as a status: "Currently Open" / "Opening Feb. 1" are the
 *     source's *announcements*, and an announcement without a year-bearing
 *     closing date cannot make a record `open` (owner rule 4) — those cards stay
 *     `unverified`.
 *   - "Rolling Deadlines" / "a rolling deadline until all funds are awarded" is
 *     the source declaring the program has no fixed deadline → `rolling`
 *     (owner rule 2), close date null.
 *   - Links: cards link to relative RISCA paths, and two link off-domain
 *     (`rifoundation.org`, `arts.ri.gov`). An off-allowlist link falls back to
 *     the official listing page — a user is never sent to an unverified host.
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
  declaresClosed,
  declaresOngoing,
  externalIdFromPath,
  fetchStateGrantSource,
  firstHref,
  officialUrl,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const RHODE_ISLAND_SOURCE_URL = "https://www.arts.ri.gov/grants/";
export const RHODE_ISLAND_SOURCE_HOST = "www.arts.ri.gov";
export const RHODE_ISLAND_APPROVED_HOSTS: readonly string[] = ["www.arts.ri.gov", "arts.ri.gov"];
export const RHODE_ISLAND_AGENCY = "Rhode Island State Council on the Arts";
export const RHODE_ISLAND_SOURCE_NAME = "Rhode Island State Council on the Arts — Our Grants";
export const RHODE_ISLAND_CONNECTOR_ID = "ri-risca-grants";
export const RHODE_ISLAND_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/rhode-island.source-validation.test.ts";

/** The card template — one program is one `ecms:paragraph-card`. */
export const RHODE_ISLAND_CONTENT_MARKER = 'data-component-id="ecms:paragraph-card"';

/** The source's own "up to $X" award wording (verbatim range + its ceiling). */
const UP_TO_RE = /\b(up to\s+\$[\d,]+(?:\.\d{2})?)/i;

interface Card {
  section: string | null;
  title: string;
  href: string | null;
  text: string;
}

/**
 * Reads the page in document order: `<h2>` sets the current cycle section, each
 * paragraph-card is one program. Only those two elements are read, so RISCA's
 * navigation, footer and script blocks can never become a record.
 */
function readCards(html: string): Card[] {
  const tokenRe =
    /<h2>([\s\S]*?)<\/h2>|<div\s+data-component-id="ecms:paragraph-card"[\s\S]*?<\/div>/gi;
  const cards: Card[] = [];
  let section: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    const raw = m[0];
    if (raw.startsWith("<h2")) {
      section = stripTags(m[1] ?? "");
      continue;
    }
    const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(raw);
    if (!link) continue;
    const title = stripTags(link[2] ?? "");
    if (title.length < 3) continue;
    cards.push({ section, title, href: link[1] ?? null, text: stripTags(raw) });
  }
  return cards;
}

/** Parses the "Our Grants" page into normalised, UNCLASSIFIED records. */
export function parseRhodeIslandGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(RHODE_ISLAND_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Rhode Island source payload is not the expected grants page (marker ${JSON.stringify(
        RHODE_ISLAND_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const cards = readCards(html);
  if (cards.length === 0) {
    throw new StateSourceError(
      "parse",
      "Rhode Island source parsed to zero program cards — the page layout changed, refusing to report an empty corpus",
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const card of cards) {
    const url = officialUrl(card.href, {
      baseUrl: RHODE_ISLAND_SOURCE_URL,
      approvedHosts: RHODE_ISLAND_APPROVED_HOSTS,
    });
    const externalId = nextId(
      externalIdFromPath(url, ["our-grants/"]) ??
        card.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    );
    // `card.text` is the whole card: title, description and the source's own
    // cycle wording. Only the source's OWN words set flags here — and dates are
    // never read from it at all (they are year-less: see the file header).
    const ongoing = declaresOngoing(card.text);
    const sourceClosed = card.section !== null && declaresClosed(card.section);
    const awardMatch = UP_TO_RE.exec(card.text);

    records.push({
      sourceKey: RHODE_ISLAND_CONNECTOR_ID,
      stateCode: "RI",
      externalId,
      title: card.title,
      agency: RHODE_ISLAND_AGENCY,
      summary: card.text || NOT_SPECIFIED,
      url,
      sourceUrl: RHODE_ISLAND_SOURCE_URL,
      // NO dates: every date on this page is year-less, and a year-less date is
      // not a date we can publish. The source's raw wording stays in `raw`.
      postedDate: null,
      closeDate: null,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: awardMatch ? awardMatch[1] : NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: awardMatch
        ? Number(awardMatch[1].replace(/[^0-9.]/g, "") || "0") || null
        : null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        sourceSection: card.section,
        cardText: card.text,
        sectionDeclaresClosed: sourceClosed,
        rollingDeclaredBySource: ongoing,
        awardPhraseFromSource: awardMatch ? awardMatch[1] : null,
        // Recorded so a reviewer can see that we saw dates and refused them:
        // the page publishes YEAR-LESS cycle wording only.
        datesPublishedBySourceAreYearless: true,
      },
    });
  }
  return records;
}

export function classifyRhodeIslandRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const rhodeIslandConnector: StateGrantConnector<string> = {
  id: RHODE_ISLAND_CONNECTOR_ID,
  stateCode: "RI",
  stateName: "Rhode Island",
  sourceName: RHODE_ISLAND_SOURCE_NAME,
  agency: RHODE_ISLAND_AGENCY,
  sourceUrl: RHODE_ISLAND_SOURCE_URL,
  officialHost: RHODE_ISLAND_SOURCE_HOST,
  sourceValidationTest: RHODE_ISLAND_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: RHODE_ISLAND_SOURCE_URL,
      marker: RHODE_ISLAND_CONTENT_MARKER,
      label: "Rhode Island",
    });
  },
  parse(raw: string) {
    return parseRhodeIslandGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyRhodeIslandRecord(record, now);
  },
};

/** Re-exported so the fixture tests can exercise non-allowlisted links. */
export { firstHref };
