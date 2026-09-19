/**
 * DISTRICT OF COLUMBIA CONNECTOR — state grants NATIONWIDE workstream, tranche
 * DC/WV/KY/AL/ME (owner nationwide order 2026-09-19, checklist §0.5; source map
 * §DC). One continuous workstream, ONE accumulating PR (#408) — no batches.
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://dmped.dc.gov/service/grant-opportunities
 * WHY THIS IS OFFICIAL: it is the **Office of the Deputy Mayor for Planning and
 * Economic Development**'s own page on the District's own `.gov` domain — the
 * agency that publishes and administers these grants. It is server-rendered
 * Drupal HTML, needs no key, no login and no JavaScript, and the listing's own
 * intro sentence is the parse marker. (`dslbd.dc.gov/service/grants`, the
 * secondary DC candidate, answers 403 Access denied from this egress — recorded
 * as egress-blocked, NOT as a rejection of the agency.)
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's listing (the Deputy
 * Mayor's cluster). The District publishes funding through other agencies and
 * councils we have NOT validated, so the registry reports the District as
 * `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - "STATUS: OPEN" IS NOT A DEADLINE. The page tags each card OPEN or CLOSED,
 *     and the Commercial Property Acquisition Fund is tagged OPEN while
 *     publishing NO date at all. The status token is kept verbatim on every
 *     record (`raw.sourceStatusText`) but is never promoted into a date: a card
 *     with no published closing date is `unverified`, exactly as the owner's
 *     rule requires ("open requires a PUBLISHED closing date that has not
 *     passed; a record whose deadline cannot be confirmed is NEVER open").
 *   - A STALE "OPEN" FLAG NEVER BEATS A PUBLISHED DATE. The Special Event Relief
 *     Fund is tagged "STATUS: OPEN" while its own published line reads
 *     "Closing: September 1, 2026" — a date that has passed. The connector keeps
 *     the date the source published and the shared classifier reports it
 *     `closed`; the source's own contradictory status line stays in `raw` so a
 *     reviewer can see both. Nothing is shown as open because a page is stale.
 *   - "STATUS: CLOSED" IS THE SOURCE'S OWN PAST-TENSE WORD and becomes
 *     `sourceClosed`, so those cycles can never be reported open even if a date
 *     on the card looks future.
 *   - THE AWARD AND CHECKLIST LINKS ARE NOT OPPORTUNITIES. The listing ends with
 *     "Business Grants Checklist", "FY25 Great Streets and Emerging Retail
 *     Awardees" and "FY24 DMPED Grant Awards" — a checklist and two award lists.
 *     The region ends at the FIRST of those markers, so no award recipient can
 *     ever become a grant record (owner rule: awards and archives are never
 *     open opportunities).
 *   - ONLY THE VALUES THE SOURCE ITSELF LABELS ARE READ ("Opened:", "Open:",
 *     "Submission Deadline:", "Closing:"). The description prose is never
 *     scanned for a date, so a sentence like "own and occupy the commercial
 *     property for at least 7 years" can never become a deadline.
 *   - A DATE BELONGS TO THE PROGRAM THE SOURCE BINDS IT TO. Each card's content
 *     is anchored on the card's OWN title, not on the paragraph that happens to
 *     carry its `STATUS:` token: the page prints the Technology Ecosystem Fund's
 *     own "Opened: March 27, 2026 / Submission Deadline: May 29, 2026" lines at
 *     the head of the paragraph that then introduces the NEXT card (Vitality
 *     Fund). A status-anchored split served TEF's dates under Vitality Fund and
 *     left TEF dateless (QA tranche-3 §2) — the ownership bug this segmentation
 *     exists to prevent.
 *   - The page publishes no eligibility, geography, award or match text in a
 *     machine-labelable form, so every one of those fields stays
 *     NOT_SPECIFIED/empty — nothing is inferred from prose.
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

export const DISTRICT_OF_COLUMBIA_SOURCE_URL = "https://dmped.dc.gov/service/grant-opportunities";
export const DISTRICT_OF_COLUMBIA_SOURCE_HOST = "dmped.dc.gov";
export const DISTRICT_OF_COLUMBIA_APPROVED_HOSTS: readonly string[] = [
  "dmped.dc.gov",
  "www.dmped.dc.gov",
];
/** The publishing body, in the page's own words. */
export const DISTRICT_OF_COLUMBIA_AGENCY =
  "Office of the Deputy Mayor for Planning and Economic Development";
export const DISTRICT_OF_COLUMBIA_SOURCE_NAME =
  "DC Office of the Deputy Mayor for Planning and Economic Development — Grant Opportunities";
export const DISTRICT_OF_COLUMBIA_CONNECTOR_ID = "dc-dmped-grant-opportunities";
export const DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/district-of-columbia.source-validation.test.ts";

/** The listing's own intro sentence — present only on this page. */
export const DISTRICT_OF_COLUMBIA_CONTENT_MARKER =
  "Explore current grant opportunities offered by the Office of the Deputy Mayor";

/**
 * Where the opportunity listing ends: the first of the page's trailing
 * checklist/award links. Everything after it is an award list, which the owner's
 * rules exclude from the opportunity corpus.
 */
export const DISTRICT_OF_COLUMBIA_REGION_END_MARKERS: readonly string[] = [
  "Business Grants Checklist",
];

/** Every `<p>` block of the listing, as the raw HTML the page publishes. */
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
/** The source's own status token — a word, never a date. */
const STATUS_RE = /\bSTATUS:\s*(OPEN|CLOSED)\b/i;

/** The values the source labels as the opening / closing of a cycle. */
const OPENING_LABELS: readonly string[] = ["Applications Open", "Opened", "Open"];
const CLOSING_LABELS: readonly string[] = ["Submission Deadline", "Closing", "Deadline"];

/**
 * The last `<strong>` element in a fragment: its own text AND its offset in the
 * fragment. The offset is what lets a card's content be sliced from its OWN
 * title rather than from the paragraph that happens to hold its `STATUS:` line
 * (see `parseDistrictOfColumbiaCards`).
 */
function lastStrongElement(html: string): { text: string; index: number } | null {
  let out: { text: string; index: number } | null = null;
  for (const m of html.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)) {
    const text = stripTags(m[1] ?? "");
    if (text.length > 0) out = { text, index: m.index ?? 0 };
  }
  return out;
}

/** The href of the anchor the page wraps its own program TITLE in, or null. */
function titleHref(html: string): string | null {
  const m = /<strong\b[^>]*>\s*<a\b[^>]*href\s*=\s*"([^"]+)"/i.exec(html);
  return m ? (m[1] ?? null) : null;
}

/**
 * The day published after ONE of the source's own labels, read on its own.
 *
 * The values live in `<br>`-separated lines ("Opened: October 1, 2025<br />
 * Closing: September 1, 2026"), so a whole-paragraph read would see two days and
 * refuse both (the Utah precedent). Reading each LABEL's line keeps both real
 * dates without ever picking between them.
 */
function labelledDayIn(content: string, labels: readonly string[]): {
  day: string | null;
  text: string | null;
  label: string | null;
} {
  const segments = content.split(/<br\s*\/?>/i);
  for (const label of labels) {
    const re = new RegExp(`\\b${label}\\s*:`, "i");
    for (const segment of segments) {
      const text = stripTags(segment);
      const m = re.exec(text);
      if (!m) continue;
      const value = text.slice(m.index + m[0].length).trim().replace(/[\s.,]+$/, "");
      if (value.length === 0) continue;
      return { day: singlePublishedDay(value), text: value, label };
    }
  }
  return { day: null, text: null, label: null };
}

interface DcCard {
  title: string;
  /** The source's own status token verbatim, e.g. "STATUS: OPEN". */
  statusText: string;
  /** True only when the source marks the cycle closed in its own words. */
  sourceClosed: boolean;
  /** The raw HTML of everything this card publishes. */
  content: string;
}

/**
 * Splits the listing into cards.
 *
 * A card is IDENTIFIED by the source's own `STATUS:` line (the page tags every
 * program OPEN or CLOSED), but its CONTENT is anchored on the card's OWN TITLE —
 * the `<strong>` the source binds that program's schedule to — never on the
 * paragraph that happens to carry the status token. On the live page one
 * paragraph can open with the PREVIOUS card's labelled schedule before it
 * reaches the next card's title:
 *
 *   <p>Opened: March 27, 2026 at 4PM EST<br/>
 *      Submission Deadline: May 29, 2026 at 4PM EST<br/><br/>
 *      <a href="/node/1757011"><strong>Vitality Fund&nbsp;</strong></a><br/><br/>
 *      <strong>STATUS: CLOSED</strong>…</p>
 *
 * Those `Opened:`/`Submission Deadline:` lines are the Technology Ecosystem
 * Fund's OWN published cycle. Anchoring content on the status block made
 * *Vitality Fund* inherit TEF's dates and left TEF dateless — a published date
 * served under the wrong program (QA tranche-3 §2). Slicing from the title's own
 * offset keeps a preceding card's schedule lines with the preceding card, so
 * ownership is decided by the source's own document order.
 */
export function parseDistrictOfColumbiaCards(region: string): DcCard[] {
  const blocks = [...region.matchAll(PARAGRAPH_RE)].map((m) => ({
    html: m[0],
    offset: m.index ?? 0,
  }));
  const statusBlocks: { index: number; statusText: string; token: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const m = STATUS_RE.exec(stripTags(blocks[i]!.html));
    if (m) {
      statusBlocks.push({
        index: i,
        statusText: (m[0] ?? "").replace(/\s+/g, " ").trim(),
        token: (m[1] ?? "").toUpperCase(),
      });
    }
  }

  const cards: { titleOffset: number; card: DcCard }[] = [];
  for (const status of statusBlocks) {
    const block = blocks[status.index]!;
    const pos = block.html.search(/\bSTATUS:/i);
    const before = pos === -1 ? "" : block.html.slice(0, pos);
    const inBlock = lastStrongElement(before);
    const useInBlock = inBlock !== null && inBlock.text.length >= 3;
    // The CLOSED cards publish title + status + dates in ONE paragraph; the OPEN
    // cards publish the title alone in the immediately preceding paragraph.
    const previous = useInBlock ? null : blocks[status.index - 1];
    const title = useInBlock ? inBlock!.text : previous ? stripTags(previous.html) : "";
    if (title.length < 3) continue;
    cards.push({
      // Where THIS card's own content starts: at its title, so nothing the
      // preceding card published can be absorbed into it.
      titleOffset: useInBlock ? block.offset + inBlock!.index : previous!.offset,
      card: {
        title,
        statusText: status.statusText,
        sourceClosed: status.token === "CLOSED",
        content: "",
      },
    });
  }

  // Each card's content runs from its OWN title to the next card's title. The
  // LAST card stops at the end of the final paragraph of the listing — never at
  // the raw region end, which is cut mid-paragraph at the checklist marker and
  // would otherwise leak the checklist/award links into the last card.
  const lastBlock = blocks[blocks.length - 1];
  const regionParagraphEnd = lastBlock ? lastBlock.offset + lastBlock.html.length : region.length;
  return cards.map((entry, i) => {
    const end = cards[i + 1]?.titleOffset ?? regionParagraphEnd;
    return {
      ...entry.card,
      content: region.slice(entry.titleOffset, Math.max(entry.titleOffset, end)),
    };
  });
}

/** Parses the DMPED grant listing into UNCLASSIFIED records. */
export function parseDistrictOfColumbiaGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(DISTRICT_OF_COLUMBIA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `District of Columbia source payload is not the expected Grant Opportunities page (marker ${JSON.stringify(
        DISTRICT_OF_COLUMBIA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const region = contentRegion(
    html,
    DISTRICT_OF_COLUMBIA_CONTENT_MARKER,
    DISTRICT_OF_COLUMBIA_REGION_END_MARKERS,
  );
  const cards = parseDistrictOfColumbiaCards(region);
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const card of cards) {
    const opening = labelledDayIn(card.content, OPENING_LABELS);
    const closing = labelledDayIn(card.content, CLOSING_LABELS);
    // The description the source publishes, read from the text that FOLLOWS its
    // own status token and STOPS before the labelled schedule — so the schedule
    // can never be mistaken for prose and vice versa.
    const contentText = stripTags(card.content);
    const statusAt = contentText.search(STATUS_RE);
    const afterStatus = statusAt === -1 ? contentText : contentText.slice(
      statusAt + (STATUS_RE.exec(contentText)?.[0].length ?? 0),
    );
    let summary = afterStatus.trim();
    for (const label of [...OPENING_LABELS, ...CLOSING_LABELS]) {
      const cut = summary.search(new RegExp(`\\b${label}\\s*:`, "i"));
      if (cut !== -1) summary = summary.slice(0, cut);
    }
    summary = summary.replace(/^[:\-\s]+/, "").replace(/\s+/g, " ").trim();

    records.push({
      sourceKey: DISTRICT_OF_COLUMBIA_CONNECTOR_ID,
      stateCode: "DC",
      externalId: nextId(slugify(card.title)),
      title: card.title,
      agency: DISTRICT_OF_COLUMBIA_AGENCY,
      summary: summary.length > 0 ? summary : NOT_SPECIFIED,
      // The card's own program page when the page links one on the official host;
      // the listing itself otherwise.
      url: officialUrl(titleHref(card.content), {
        baseUrl: DISTRICT_OF_COLUMBIA_SOURCE_URL,
        approvedHosts: DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
        canonicalHost: DISTRICT_OF_COLUMBIA_SOURCE_HOST,
      }),
      sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE_URL,
      postedDate: opening.day,
      closeDate: closing.day,
      estimatedCloseDate: null,
      // The page never says a program is year-round/rolling, so nothing here can
      // become `rolling` by inference.
      ongoing: false,
      sourceClosed: card.sourceClosed,
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
        // The source's own words, verbatim — including the status token that may
        // contradict the published date (see the header).
        sourceStatusText: card.statusText,
        sourceStatusDeclaresClosed: card.sourceClosed,
        sourceStatusDeclaresOpen: !card.sourceClosed,
        sourceClosedDeclaredBySource: card.sourceClosed,
        rollingDeclaredBySource: false,
        openingText: opening.text,
        closingText: closing.text,
        applicationDueDateText: closing.text,
        deadlineLabel: closing.label,
        openingDayPublishedBySource: opening.day,
        closingDayPublishedBySource: closing.day,
        pagePublishesNoPerProgramDeadline: closing.day === null,
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "District of Columbia source parsed to zero grant cards — the listing layout changed, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyDistrictOfColumbiaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const districtOfColumbiaConnector: StateGrantConnector<string> = {
  id: DISTRICT_OF_COLUMBIA_CONNECTOR_ID,
  stateCode: "DC",
  stateName: "District of Columbia",
  sourceName: DISTRICT_OF_COLUMBIA_SOURCE_NAME,
  agency: DISTRICT_OF_COLUMBIA_AGENCY,
  sourceUrl: DISTRICT_OF_COLUMBIA_SOURCE_URL,
  officialHost: DISTRICT_OF_COLUMBIA_SOURCE_HOST,
  sourceValidationTest: DISTRICT_OF_COLUMBIA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: DISTRICT_OF_COLUMBIA_SOURCE_URL,
      marker: DISTRICT_OF_COLUMBIA_CONTENT_MARKER,
      label: "District of Columbia",
      approvedHosts: DISTRICT_OF_COLUMBIA_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseDistrictOfColumbiaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyDistrictOfColumbiaRecord(record, now);
  },
};
