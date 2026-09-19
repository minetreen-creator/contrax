/**
 * MAINE CONNECTOR — state grants NATIONWIDE workstream, tranche DC/WV/KY/AL/ME
 * (owner nationwide order 2026-09-19; source map §ME).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://mainearts.maine.gov/Pages/Funding/Grants-Home
 * WHY THIS IS OFFICIAL: it is the **Maine Arts Commission**'s own Grants Home
 * page — a Maine state agency, on the state's `.gov` domain. It is server-rendered
 * HTML, needs no key, no login and no JavaScript.
 * The DEEP URL is hard-coded rather than the site root: the root timed out once
 * during discovery and carries no listing, while this page publishes the funding
 * cycles themselves (`maine.gov/decd`, the other Maine candidate, is a stale-2019
 * economic-development page and is NOT the arts agency's listing).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's listing. Maine
 * publishes funding through other departments we have NOT validated, so the
 * registry reports Maine as `limited`, never `connected`.
 *
 * WHAT THE PAGE PUBLISHES — two shapes, both read here
 *   ① "CURRENT AND UPCOMING OPPORTUNITIES": `<h2>` cards carrying the agency's own
 *      labels "Applications Open:" and "Application Deadline:".
 *   ② The "ARTIST FUNDING" / "ORGANIZATIONAL FUNDING" directory: `<h3>` cards
 *      carrying the agency's own "Current Status:" (Open / Closed / Visit Cultural
 *      Resources) and, where a cycle is running, "Application Deadline:".
 *
 * HONESTY TRAPS HANDLED HERE
 *   - "Current Status: Closed" IS THE SOURCE'S OWN PAST-TENSE WORD and becomes
 *     `sourceClosed`, so nothing filed as closed can ever be served as open — even
 *     though the page keeps publishing it (never delete a closed cycle, and never
 *     present it as an opportunity just because the page is live).
 *   - "Current Status: Open" IS NOT A DEADLINE. It is kept verbatim in `raw`; the
 *     status itself never becomes a date, and the closing date still has to be
 *     published by the source for a record to be `open` (the owner's rule).
 *   - "Current Status: Visit Cultural Resources" IS NEITHER OPEN NOR CLOSED, and
 *     that program publishes no date at all: it stays a record and stays
 *     `unverified` rather than being guessed in either direction.
 *   - ONE PROGRAM PUBLISHED TWICE IS ONE RECORD. The same programs appear in both
 *     shapes (the "Organization Operations Grant" and the "Maine Artist
 *     Fellowship" are each listed as a current opportunity AND in the funding
 *     directory). The record identity is the source's OWN page path for the
 *     program, so the second publication of the same program is the same identity
 *     and is de-duplicated — never two rows for one grant.
 *   - ONLY THE SOURCE'S OWN LABELLED VALUES ARE READ, and a value is read to the
 *     end of ITS OWN line only, so "Award Notifications: Mid-January 2027" can
 *     never become a deadline and a `<span>`-wrapped status still reads correctly.
 *   - The page publishes no structured eligibility / geography / award / match
 *     values beyond the labels it uses, so every other field stays
 *     NOT_SPECIFIED/empty — nothing inferred.
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
  externalIdFromPath,
  fetchStateGrantSource,
  firstHref,
  officialUrl,
  singlePublishedDay,
  stripTags,
} from "~/lib/state-grants/connectors/source-support";

export const MAINE_SOURCE_URL = "https://mainearts.maine.gov/Pages/Funding/Grants-Home";
export const MAINE_SOURCE_HOST = "mainearts.maine.gov";
export const MAINE_APPROVED_HOSTS: readonly string[] = ["mainearts.maine.gov", "maine.gov"];
export const MAINE_AGENCY = "Maine Arts Commission";
export const MAINE_SOURCE_NAME =
  "Maine Arts Commission — Grants Home (current and upcoming opportunities + funding directory)";
export const MAINE_CONNECTOR_ID = "me-arts-commission-grants-home";
export const MAINE_SOURCE_VALIDATION_TEST = "src/lib/state-grants/maine.source-validation.test.ts";

/** The listing's own heading — present only on this page. */
export const MAINE_CONTENT_MARKER = "CURRENT AND UPCOMING OPPORTUNITIES";

/** Region ① — the current/upcoming opportunity cards. */
export const MAINE_REGION_END_MARKERS: readonly string[] = ["About Our Grants"];
/** Region ② — the funding directory (artist + organizational funding). */
export const MAINE_DIRECTORY_START = 'id="Artist-Funding"';
export const MAINE_DIRECTORY_END_MARKERS: readonly string[] = ['id="Disclaimer"'];

const CARD_H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
const CARD_H3_RE = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
const OPEN_LABEL_RE = /\bApplications Open\s*:/i;
const DEADLINE_LABEL_RE = /\bApplication Deadline\s*:/i;
const STATUS_LABEL_RE = /\bCurrent Status\s*:/i;
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/**
 * The value the source publishes after one of its own labels, read only to the
 * end of THAT label's own line — so a later label's date can never be pulled in.
 */
function labelledValue(block: string, labelRe: RegExp): string | null {
  const at = block.search(labelRe);
  if (at === -1) return null;
  const tail = block.slice(at);
  const close = tail.indexOf("</strong>");
  const after = close === -1 ? tail : tail.slice(close + "</strong>".length);
  const line = (after.split(/<\/p>|<br\s*\/?>/i)[0] ?? after).replace(/⇒|&rArr;/g, "");
  const text = stripTags(line).trim();
  return text.length > 0 ? text : null;
}

/** The first paragraph with real prose inside a card, or "". */
function proseIn(cardHtml: string): string {
  for (const m of cardHtml.matchAll(PARAGRAPH_RE)) {
    const text = stripTags(m[1] ?? "");
    if (text.length > 40) return text;
  }
  return "";
}

interface MaineCard {
  title: string;
  cardHtml: string;
  /** The labelled status value, when this shape publishes one. */
  statusValue: string | null;
}

function cardFrom(match: RegExpExecArray, html: string, nextIndex: number): MaineCard | null {
  const title = stripTags(match[1] ?? "");
  if (title.length < 3) return null;
  const start = match.index ?? 0;
  return {
    title,
    cardHtml: html.slice(start, nextIndex),
    statusValue: null,
  };
}

/** Parses the Maine Arts Commission Grants Home page into UNCLASSIFIED records. */
export function parseMaineGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(MAINE_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Maine source payload is not the expected Grants Home page (marker ${JSON.stringify(
        MAINE_CONTENT_MARKER,
      )} missing)`,
    );
  }

  const cards: MaineCard[] = [];

  // ① The current/upcoming opportunity cards (`<h2>`).
  const currentRegion = contentRegion(html, MAINE_CONTENT_MARKER, MAINE_REGION_END_MARKERS);
  const h2s = [...currentRegion.matchAll(CARD_H2_RE)];
  for (let i = 0; i < h2s.length; i++) {
    const card = cardFrom(h2s[i]!, currentRegion, h2s[i + 1]?.index ?? currentRegion.length);
    if (card) cards.push(card);
  }

  // ② The funding directory cards (`<h3>`), which publish "Current Status:".
  const directoryRegion = contentRegion(html, MAINE_DIRECTORY_START, MAINE_DIRECTORY_END_MARKERS);
  const h3s = [...directoryRegion.matchAll(CARD_H3_RE)];
  for (let i = 0; i < h3s.length; i++) {
    const card = cardFrom(h3s[i]!, directoryRegion, h3s[i + 1]?.index ?? directoryRegion.length);
    if (!card) continue;
    cards.push({ ...card, statusValue: labelledValue(card.cardHtml, STATUS_LABEL_RE) });
  }

  const records: SourceGrantRecord[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const resolved = officialUrl(firstHref(card.cardHtml), {
      baseUrl: MAINE_SOURCE_URL,
      approvedHosts: MAINE_APPROVED_HOSTS,
      canonicalHost: MAINE_SOURCE_HOST,
    });
    // A card whose only link is the listing itself (the Traditional Arts
    // Apprenticeship's "Visit Cultural Resources") has no page of its own: the
    // listing IS its source, and its identity comes from its own title rather
    // than from a link that would make the whole listing one identity.
    const hasOwnPage = resolved !== MAINE_SOURCE_URL;
    const url = hasOwnPage ? resolved : MAINE_SOURCE_URL;
    // The source's OWN page path for the program is the record identity, so the
    // same program published in both shapes is ONE record (see the header).
    const externalId =
      (hasOwnPage ? externalIdFromPath(resolved, ["Pages/Funding"]) : null) ?? slugify(card.title);
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const opening = labelledValue(card.cardHtml, OPEN_LABEL_RE);
    const deadline = labelledValue(card.cardHtml, DEADLINE_LABEL_RE);
    const statusText = card.statusValue;
    // The source's own past-tense word wins; a date cannot override it.
    const sourceClosed = statusText !== null
      ? declaresClosed(statusText)
      : false;

    records.push({
      sourceKey: MAINE_CONNECTOR_ID,
      stateCode: "ME",
      externalId,
      title: card.title,
      agency: MAINE_AGENCY,
      summary: proseIn(card.cardHtml) || NOT_SPECIFIED,
      url,
      sourceUrl: MAINE_SOURCE_URL,
      postedDate: opening === null ? null : singlePublishedDay(opening),
      closeDate: deadline === null ? null : singlePublishedDay(deadline),
      estimatedCloseDate: null,
      // The page never declares a program year-round/rolling here.
      ongoing: false,
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
        sourceStatusText: statusText,
        sourceStatusValue: statusText,
        sourceClosedDeclaredBySource: sourceClosed,
        rollingDeclaredBySource: false,
        openingText: opening,
        closingText: deadline,
        applicationDueDateText: deadline,
        openingDayPublishedBySource: opening === null ? null : singlePublishedDay(opening),
        closingDayPublishedBySource: deadline === null ? null : singlePublishedDay(deadline),
        // "Current Status: Visit Cultural Resources" is neither open nor closed,
        // and that program publishes no date: it is honestly `unverified`.
        statusIsNeitherOpenNorClosed:
          statusText !== null && !sourceClosed && !/\bopen\b/i.test(statusText),
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Maine source parsed to zero programs — the Grants Home layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyMaineRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const maineConnector: StateGrantConnector<string> = {
  id: MAINE_CONNECTOR_ID,
  stateCode: "ME",
  stateName: "Maine",
  sourceName: MAINE_SOURCE_NAME,
  agency: MAINE_AGENCY,
  sourceUrl: MAINE_SOURCE_URL,
  officialHost: MAINE_SOURCE_HOST,
  sourceValidationTest: MAINE_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: MAINE_SOURCE_URL,
      marker: MAINE_CONTENT_MARKER,
      label: "Maine",
      approvedHosts: MAINE_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseMaineGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyMaineRecord(record, now);
  },
};
