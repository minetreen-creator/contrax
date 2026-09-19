/**
 * NORTH DAKOTA CONNECTOR — state grants NATIONWIDE workstream, batch 2
 * (owner nationwide order 2026-09-19; source chosen from the phase-1 discovery
 * report row ND and re-verified against the raw capture by the batch-2 design
 * session; fixture cut from the 2026-09-19 capture).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.arts.nd.gov/grants
 * WHY THIS IS OFFICIAL: it is "Grants at a Glance", published by the **North
 * Dakota Council on the Arts** — the state arts agency — on its own `.gov`
 * domain, server-rendered (Drupal), no key, HTTP 200 at capture (121 880 B). Each
 * program is one card carrying the source's own `What:` / `Who:` / `Deadline:`
 * lines, including the source's own passed-marker ("*deadline has passed"). The
 * captured page is the saved fixture the unit tests parse
 * (`fixtures/north-dakota-arts-grants.html`).
 *
 * THE CANDIDATE THAT WAS NOT USED (documented):
 *   - https://www.commerce.nd.gov/services-assistance/grant-programs — checked
 *     live 2026-09-19 and NOT used: its index publishes zero dates. arts.nd.gov
 *     stays the single source.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's grants listing. North
 * Dakota publishes funding through other agencies we have NOT validated, so the
 * registry reports North Dakota as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - The source's own passed-marker is ROUND-SCOPED on the two-round "Community
 *     Arts Access" card ("*Round 1 deadline has passed"). It must NOT make the
 *     whole program `closed`, so `sourceClosed` requires the marker AND the
 *     absence of a "Round N" label. This is a connector-local rule, documented
 *     because the shared `declaresClosed()` does not match this wording at all.
 *   - A two-round card publishes SEVERAL DIFFERENT days, so `singlePublishedDay()`
 *     returns null and the program is `unverified` — no round is picked for the
 *     user (the Pennsylvania / Hawaii precedent).
 *   - Three cards publish "Deadline: 6 weeks prior to project start date" — a
 *     rule, not a date. They stay `unverified`; they are NEVER `rolling`, because
 *     the source does not declare continuous acceptance.
 *   - Every date is read from the card's own `Deadline:` text only. The `What:`
 *     line's "for 3 years" / "every 3 years" wording is a description, not a
 *     deadline, and can never become a date.
 *   - Award wording is the card's own leading money phrase from `What:` (a single
 *     amount is the ceiling); `Who:` is the source's own eligibility statement.
 *     Nothing else is published on this page, so geography/categories/match stay
 *     `NOT_SPECIFIED`/empty.
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
  declaresOngoing,
  fetchStateGrantSource,
  officialUrl,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const NORTH_DAKOTA_SOURCE_URL = "https://www.arts.nd.gov/grants";
export const NORTH_DAKOTA_SOURCE_HOST = "www.arts.nd.gov";
export const NORTH_DAKOTA_APPROVED_HOSTS: readonly string[] = [
  "www.arts.nd.gov",
  "arts.nd.gov",
];
/** The publishing body, in the page's own words (verified in the live page text). */
export const NORTH_DAKOTA_AGENCY = "North Dakota Council on the Arts";
export const NORTH_DAKOTA_SOURCE_NAME = "North Dakota Council on the Arts — Grants at a Glance";
export const NORTH_DAKOTA_CONNECTOR_ID = "nd-arts-grants-at-a-glance";
export const NORTH_DAKOTA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/north-dakota.source-validation.test.ts";

/** The listing's own heading — present only on the "Grants at a Glance" page. */
export const NORTH_DAKOTA_CONTENT_MARKER = "<h1>Grants at a Glance";
export const NORTH_DAKOTA_REGION_END_MARKERS: readonly string[] = [
  '<h2 class="visually-hidden">Footer',
];

/** One card starts at its card-link anchor (title, body and URL all follow it). */
const CARD_ANCHOR_RE = /<a\b[^>]*class="card-link"[^>]*>/gi;
const CARD_TITLE_RE =
  /field--name-field-featured-area-card-title[^>]*>([\s\S]*?)<\/div>/i;
const CARD_DESCRIPTION_RE =
  /field--name-field-featured-area-card-descrip[^>]*>([\s\S]*?)<\/div>/i;
const DEADLINE_LABEL_RE = /Deadlines?\s*:/i;
const PASSED_MARKER_RE = /deadline has passed/i;
const ROUND_LABEL_RE = /\bRound\s*\d/i;
const MONEY_RE = /\$\s?\d[\d,]*/g;

interface Card {
  title: string;
  href: string | null;
  whatText: string;
  whoText: string;
  deadlineText: string;
}

/** The card's own labelled `What:` / `Who:` / `Deadline:` values. */
function readCard(segment: string): Card | null {
  const titleMatch = CARD_TITLE_RE.exec(segment);
  const title = titleMatch ? stripTags(titleMatch[1] ?? "") : "";
  if (title.length < 3) return null;
  const desc = CARD_DESCRIPTION_RE.exec(segment);
  const descHtml = desc ? (desc[1] ?? "") : "";
  // Labels are matched on the STRIPPED paragraph text, never on the raw markup:
  // this page wraps the label in `<strong>` inconsistently (most cards publish
  // "<strong>Deadline:</strong> April 30, 2026", but the Folk and Traditional
  // Arts Apprenticeship card publishes "<strong>Deadline</strong>: April 30,
  // 2026"). A raw-markup search for "Deadline:" silently missed that card's real
  // published deadline and dropped the whole program. Stripping the tags first
  // normalises both spellings to "Deadline: …".
  const paragraphs = [
    ...descHtml.matchAll(/<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi),
  ].map((m) => stripTags(m[1] ?? ""));
  const labelText = (label: RegExp): string => {
    const paragraph = paragraphs.find((t) => label.test(t));
    return paragraph ? paragraph.replace(label, "").trim() : "";
  };
  const whatText = labelText(/^What\s*:/i);
  const whoText = labelText(/^Who\s*:/i);
  // The deadline line PLUS everything the card publishes after it (the two-round
  // card puts its rounds in a list and its round-scoped marker in a later
  // paragraph), so a multi-round cycle is seen whole and never resolves to one day.
  const idx = paragraphs.findIndex((t) => DEADLINE_LABEL_RE.test(t));
  const deadlineText = idx === -1 ? "" : paragraphs.slice(idx).join(" ").trim();
  const href = /href\s*=\s*"([^"]+)"/i.exec(segment)?.[1] ?? null;
  return { title, href, whatText, whoText, deadlineText };
}

/** The card's own leading money phrase, and its min/max amounts. */
function awardFrom(whatText: string): {
  awardRange: string;
  awardMinAmount: number | null;
  awardMaxAmount: number | null;
} {
  const matches = [...whatText.matchAll(MONEY_RE)];
  if (matches.length === 0) {
    return { awardRange: NOT_SPECIFIED, awardMinAmount: null, awardMaxAmount: null };
  }
  const last = matches[matches.length - 1]!;
  const awardRange = whatText
    .slice(0, (last.index ?? 0) + last[0].length)
    .trim()
    .slice(0, 120);
  const amounts = matches
    .map((m) => Number(m[0].replace(/[^0-9]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  // A single published amount is the ceiling; two become min and max.
  if (amounts.length === 1) {
    return { awardRange, awardMinAmount: null, awardMaxAmount: amounts[0]! };
  }
  return {
    awardRange,
    awardMinAmount: Math.min(...amounts),
    awardMaxAmount: Math.max(...amounts),
  };
}

/** Parses "Grants at a Glance" into normalised, UNCLASSIFIED records. */
export function parseNorthDakotaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(NORTH_DAKOTA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `North Dakota source payload is not the expected grants page (marker ${JSON.stringify(
        NORTH_DAKOTA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(
    html,
    NORTH_DAKOTA_CONTENT_MARKER,
    NORTH_DAKOTA_REGION_END_MARKERS,
  );
  const anchors = [...region.matchAll(CARD_ANCHOR_RE)];
  if (anchors.length === 0) {
    throw new StateSourceError(
      "parse",
      "North Dakota source no longer publishes its grant cards — refusing to report an empty corpus",
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  anchors.forEach((anchor, i) => {
    const start = anchor.index;
    const next = anchors[i + 1];
    const segment = region.slice(start, next ? next.index : region.length);
    const card = readCard(segment);
    if (!card || card.deadlineText.length === 0) return;

    const url = officialUrl(card.href, {
      baseUrl: NORTH_DAKOTA_SOURCE_URL,
      approvedHosts: NORTH_DAKOTA_APPROVED_HOSTS,
      canonicalHost: NORTH_DAKOTA_SOURCE_HOST,
    });
    // A published closing day, or null when the card publishes several different
    // days (the two-round cycle) or no day at all ("6 weeks prior…").
    const closeDate = singlePublishedDay(card.deadlineText);
    // The passed-marker is round-scoped on the two-round card: it may only close
    // the WHOLE program when it is not tied to a specific round.
    const sourceClosed =
      PASSED_MARKER_RE.test(card.deadlineText) && !ROUND_LABEL_RE.test(card.deadlineText);
    const ongoing = declaresOngoing(card.deadlineText);
    const award = awardFrom(card.whatText);

    records.push({
      sourceKey: NORTH_DAKOTA_CONNECTOR_ID,
      stateCode: "ND",
      externalId: nextId(slugify(card.title)),
      title: card.title,
      agency: NORTH_DAKOTA_AGENCY,
      summary: card.whatText || NOT_SPECIFIED,
      url,
      sourceUrl: NORTH_DAKOTA_SOURCE_URL,
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: card.whoText || NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: award.awardRange,
      awardMinAmount: award.awardMinAmount,
      awardMaxAmount: award.awardMaxAmount,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        deadlineText: card.deadlineText,
        closingText: card.deadlineText,
        whatText: card.whatText,
        whoText: card.whoText,
        // Same keys + meanings the shared live harness reads.
        sourceClosedDeclaredBySource: sourceClosed,
        rollingDeclaredBySource: ongoing,
        // Documented: the passed-marker is round-scoped on the two-round card, so
        // it never sets sourceClosed for that program.
        passedMarkerIsRoundScoped: PASSED_MARKER_RE.test(card.deadlineText) && ROUND_LABEL_RE.test(card.deadlineText),
        deadlinesStatedAsARule: closeDate === null && card.deadlineText.length > 0,
        categoriesPublished: false,
      },
    });
  });

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "North Dakota source parsed to zero programs — the card layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyNorthDakotaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const northDakotaConnector: StateGrantConnector<string> = {
  id: NORTH_DAKOTA_CONNECTOR_ID,
  stateCode: "ND",
  stateName: "North Dakota",
  sourceName: NORTH_DAKOTA_SOURCE_NAME,
  agency: NORTH_DAKOTA_AGENCY,
  sourceUrl: NORTH_DAKOTA_SOURCE_URL,
  officialHost: NORTH_DAKOTA_SOURCE_HOST,
  sourceValidationTest: NORTH_DAKOTA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: NORTH_DAKOTA_SOURCE_URL,
      marker: NORTH_DAKOTA_CONTENT_MARKER,
      label: "North Dakota",
      approvedHosts: NORTH_DAKOTA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseNorthDakotaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyNorthDakotaRecord(record, now);
  },
};
