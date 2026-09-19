/**
 * ARIZONA CONNECTOR — state grants P3, batch #1 (owner rollout order
 * 2026-09-18; batch chosen, live-verified and fixture-saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://azarts.gov/grants/
 * WHY THIS IS OFFICIAL: it is published by the **Arizona Commission on the
 * Arts** — the state's arts agency — on its own `.gov` domain, it is a public
 * server-rendered listing, it needs no key, and it names each program's own
 * application cycle (`Application Period Begins:` / `Application Deadline:` plus
 * the source's own "Application Period Open/Closed" label). It was verified live
 * on 2026-09-19 (HTTP 200, 6 program cards) and the fetched page is the saved
 * fixture the unit tests parse (`fixtures/arizona-azarts.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's programs. Arizona
 * publishes programs through other agencies we have not validated, so the
 * registry reports Arizona as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch source-verification report):
 *   - The page publishes NO per-card categories (only a filter widget), so
 *     `categories` stays `[]` — an empty array, never an inferred list.
 *   - The page publishes NO per-card eligibility, geography, award amount or
 *     match, so each of those columns is `NOT_SPECIFIED` / null.
 *   - The "Found 6 Results of 6" strip is a `<div class="grant">` with NO state
 *     class; blocks are only read when the class carries `accepting`/`closed`.
 *   - The source's own visible cycle label ("Application Period Closed") is what
 *     sets `sourceClosed`; the card's class is only a fallback, and both agree on
 *     the live page (verified 2026-09-19).
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
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const ARIZONA_SOURCE_URL = "https://azarts.gov/grants/";
export const ARIZONA_SOURCE_HOST = "azarts.gov";
export const ARIZONA_APPROVED_HOSTS: readonly string[] = ["azarts.gov", "www.azarts.gov"];
export const ARIZONA_AGENCY = "Arizona Commission on the Arts";
export const ARIZONA_SOURCE_NAME = "Arizona Commission on the Arts — Grants";
export const ARIZONA_CONNECTOR_ID = "az-azarts-grants";
export const ARIZONA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/arizona.source-validation.test.ts";

/** The record-level template: the state class only exists on real cards. */
export const ARIZONA_CONTENT_MARKER = 'class="grant ';

/** One program card = `<div class="grant accepting|closed ">`. */
const CARD_START_RE = /<div class="grant\s+(accepting|closed)\b[^"]*">/g;

interface Card {
  stateClass: string;
  html: string;
}

function splitCards(html: string): Card[] {
  const starts: { index: number; stateClass: string; length: number }[] = [];
  for (const m of html.matchAll(CARD_START_RE)) {
    starts.push({ index: m.index ?? 0, stateClass: m[1] ?? "", length: m[0].length });
  }
  return starts.map((s, i) => ({
    stateClass: s.stateClass,
    html: html.slice(
      s.index,
      i + 1 < starts.length ? starts[i + 1].index : Math.min(html.length, s.index + 12_000),
    ),
  }));
}

/** The value of a `<strong>Label:</strong> value` pair inside a card. */
function labeledValue(cardHtml: string, label: string): string | null {
  const re = new RegExp(`${label}:\\s*<\\/strong>\\s*([^<]+)`, "i");
  const m = re.exec(cardHtml);
  return m ? stripTags(m[1] ?? "") : null;
}

/** The source's own visible cycle label, e.g. "Application Period Closed". */
function cycleLabel(cardHtml: string): string | null {
  const m = /<div id="grant-status">[\s\S]*?<div class="circle[^"]*"><\/div>([^<]*)</i.exec(cardHtml);
  return m ? stripTags(m[1] ?? "") : null;
}

/** Parses the grants page into normalised, UNCLASSIFIED records. */
export function parseArizonaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(ARIZONA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Arizona source payload is not the expected grants page (marker ${JSON.stringify(
        ARIZONA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const cards = splitCards(html);
  if (cards.length === 0) {
    throw new StateSourceError(
      "parse",
      "Arizona source parsed to zero program cards — the page layout changed, refusing to report an empty corpus",
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const card of cards) {
    const titleMatch = /<h3>\s*<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(card.html);
    if (!titleMatch) continue;
    const title = stripTags(titleMatch[2] ?? "");
    if (title.length < 3) continue;

    const url = officialUrl(titleMatch[1] ?? null, {
      baseUrl: ARIZONA_SOURCE_URL,
      approvedHosts: ARIZONA_APPROVED_HOSTS,
    });
    const slug = externalIdFromPath(url, ["grant/"]);
    const externalId = nextId(slug ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));

    const summaryMatch = /<p>([\s\S]*?)<\/p>/i.exec(card.html);
    const summary = summaryMatch ? stripTags(summaryMatch[1] ?? "") : "";

    const postedDate = singlePublishedDay(labeledValue(card.html, "Application Period Begins") ?? "");
    const closeDate = singlePublishedDay(labeledValue(card.html, "Application Deadline") ?? "");
    const label = cycleLabel(card.html);
    // The source's own visible words decide "closed"; the class is the fallback
    // when the label is absent (both are the source's own markup).
    const sourceClosed = label !== null ? declaresClosed(label) : card.stateClass === "closed";
    const ongoing = declaresOngoing(summary);

    records.push({
      sourceKey: ARIZONA_CONNECTOR_ID,
      stateCode: "AZ",
      externalId,
      title,
      agency: ARIZONA_AGENCY,
      summary: summary || NOT_SPECIFIED,
      url,
      sourceUrl: ARIZONA_SOURCE_URL,
      postedDate,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      // The page publishes no per-record "last updated" stamp; amendment
      // detection rides on the content fingerprint (CONVENTIONS.md §3).
      sourceUpdatedAt: null,
      // The page publishes none of these per card — an empty list, and
      // "Not specified" — never an inference from the filter widget.
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        cardStateClass: card.stateClass,
        cycleLabel: label,
        cycleLabelDeclaresClosed: sourceClosed,
        applicationPeriodBegins: labeledValue(card.html, "Application Period Begins"),
        applicationDeadline: labeledValue(card.html, "Application Deadline"),
        categoriesPublished: false,
      },
    });
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyArizonaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector the registry, the sources registry and the runner use. */
export const arizonaConnector: StateGrantConnector<string> = {
  id: ARIZONA_CONNECTOR_ID,
  stateCode: "AZ",
  stateName: "Arizona",
  sourceName: ARIZONA_SOURCE_NAME,
  agency: ARIZONA_AGENCY,
  sourceUrl: ARIZONA_SOURCE_URL,
  officialHost: ARIZONA_SOURCE_HOST,
  sourceValidationTest: ARIZONA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: ARIZONA_SOURCE_URL,
      marker: ARIZONA_CONTENT_MARKER,
      label: "Arizona",
    });
  },
  parse(raw: string) {
    return parseArizonaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyArizonaRecord(record, now);
  },
};

/** Re-exported so the fixture tests can exercise link handling directly. */
export { firstHref };
