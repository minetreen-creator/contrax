/**
 * OKLAHOMA CONNECTOR — state grants NATIONWIDE workstream, continuous tranche
 * NV/OK/SC/IL (owner correction 2026-09-19, ratified 243: ONE continuous
 * workstream, ONE accumulating PR #408; source map §OK).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://oklahoma.gov/arts/grants/grants-for-organizations.html   (primary)
 *   https://oklahoma.gov/arts/grants/grants-for-schools.html         (the same
 *                                                                     source's
 *                                                                     second index)
 * WHY THIS IS OFFICIAL: both are the **Oklahoma Arts Council**'s own program
 * indexes on the State of Oklahoma's canonical `oklahoma.gov` domain (the source
 * map's §4 note prefers `oklahoma.gov` and names `arts.ok.gov` a LEGACY host that
 * must never be hard-coded — it is not referenced anywhere here). They are
 * server-rendered Adobe-Experience-Manager HTML: no key, no login, no JavaScript.
 *
 * WHY ONE CONNECTOR READS TWO PAGES (checklist §0.5 step 3 — combine official
 * agency sources): the Council's `/arts/grants.html` hub publishes NO per-program
 * date at all (verified live 2026-09-19: its only date in the body is a "Last
 * Modified on Jul 07, 2026" stamp), and it splits its dated programs across these
 * two indexes — organizations and schools. The Council is ONE agency on ONE host,
 * so this is ONE source read across its two program indexes, and both pages are
 * fetched fail-closed every run (either page failing fails the whole state).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE agency's programs (the Arts
 * Council). Oklahoma publishes funding through other departments we have NOT
 * validated, so the registry reports Oklahoma as `limited`.
 *
 * WHAT THE PAGES PUBLISH: one `<h3 class="cmp-title__text">` card per program,
 * each with the Council's own labelled paragraphs — "Project Activity Dates",
 * "Grant Amount", "Application Deadlines" (the organizations index) and
 * "Application Period" (ONE card on the schools index).
 *
 * HONESTY TRAPS HANDLED HERE
 *   - "Project Activity Dates" IS NOT AN APPLICATION DEADLINE. It is the period
 *     the funded ACTIVITY runs ("July 1, 2026 - June 30, 2027 (Grant Period
 *     FY2027)"). The label is never read, so no activity period can become a
 *     closing date — the trap most of these cards carry.
 *   - "(Closed)" IS THE SOURCE'S OWN PAST TENSE. Several cards publish their
 *     deadline as a date followed by the Council's own "(Closed)"/"(closed)"
 *     marker, and one publishes "(Closed)" with no date at all. The marker is
 *     read as `sourceClosed` (so those cycles can never be served open) and the
 *     date the source published alongside it is kept as the published close date.
 *   - THE COUNCIL LABELS ITS APPLICATION WINDOW TWO WAYS, and both are the
 *     Council's own label for the same fact: "Application Deadlines" on twelve of
 *     the thirteen cards, and "Application Period" on ONE schools card, whose
 *     value is a WINDOW — "April 1 – May 1, 2026, at 5:00 p.m. Central Time
 *     (closed)" (QA finding, tranche NV/OK/SC/IL, 2026-09-19: that card was
 *     served `unverified` while publishing a dated closed window, because only
 *     the "Application Deadlines" label was read). The window is read as its two
 *     SOURCE-ORDERED ends — never as a picked date: the CLOSING end is the
 *     Council's own published close date, and the opening end is used only to
 *     confirm the range ASCENDS (readable, ascending ends or no date at all).
 *     The opening end carries no year of its own, so its year is taken from the
 *     window's own closing end; it is never served as a date of the record
 *     (`postedDate` stays empty — see `readOklahomaApplicationPeriod`).
 *   - THE "(closed)" MARK AND THE END DATE MUST AGREE. A past-tense marker on a
 *     card that publishes no readable window still means closed with NO date
 *     (never an invented one), and a window's end is only served alongside a
 *     dated `closed` when that end has actually PASSED — the classifier keeps the
 *     Council's own past tense for the status but withholds a date its own words
 *     contradict (see `classifyOklahomaRecord`).
 *   - A DEADLINE RULE IS NOT A DATE. Three cards publish "60 days before your
 *     project begins." — a rule, never a deadline. It parses to no day, so those
 *     records stay honestly `unverified`.
 *   - A PASSED PUBLISHED DEADLINE IS `closed` (the Council's own
 *     "September 15, 2026" card is served closed, not open), and a card with no
 *     "Application Deadlines" paragraph at all stays `unverified` — never open.
 *   - The pages publish no eligibility/geography/summary text in a machine-
 *     labelable form, so those fields stay NOT_SPECIFIED/empty.
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  parseStateDay,
  stateDayEpoch,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { easternDayStart } from "~/lib/grants";
import {
  StateSourceError,
  declaresClosed,
  declaresOngoing,
  fetchStateGrantSource,
  publishedAmountRange,
  publishedRangeEnds,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

/** The primary index — the source's `official_url` in `state_grant_sources`. */
export const OKLAHOMA_SOURCE_URL = "https://oklahoma.gov/arts/grants/grants-for-organizations.html";
/** The agency's two program indexes, BOTH read as ONE source (see the header). */
export const OKLAHOMA_SOURCE_URLS: readonly string[] = [
  OKLAHOMA_SOURCE_URL,
  "https://oklahoma.gov/arts/grants/grants-for-schools.html",
];
export const OKLAHOMA_SOURCE_HOST = "oklahoma.gov";
export const OKLAHOMA_APPROVED_HOSTS: readonly string[] = ["oklahoma.gov", "www.oklahoma.gov"];
/** The publishing body, in the pages' own words. */
export const OKLAHOMA_AGENCY = "Oklahoma Arts Council";
export const OKLAHOMA_SOURCE_NAME =
  "Oklahoma Arts Council — Grants for Organizations & Grants for Schools";
export const OKLAHOMA_CONNECTOR_ID = "ok-arts-council-grants";
export const OKLAHOMA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/oklahoma.source-validation.test.ts";

/** The Council's own labelled deadline paragraph — present on both indexes. */
export const OKLAHOMA_CONTENT_MARKER = "Application Deadlines";

/** Joins the source's own pages inside the one raw payload. */
export const OKLAHOMA_PAGE_SEPARATOR = "\n<!-- contrax:oklahoma-source-page-boundary -->\n";

const CARD_SPLIT_RE = /<h3\b[^>]*class="cmp-title__text"[^>]*>/gi;
const TITLE_END = "</h3>";
const ACTIVITY_LABEL_RE = /\bProject\s+Activity\s+Dates\s*/i;
const AMOUNT_LABEL_RE = /\bGrant\s+Amount\s*/i;
const DEADLINE_LABEL_RE = /\bApplication\s+Deadlines?\s*/i;
/**
 * The Council's OTHER own label for the same fact — the schools index uses it on
 * ONE card ("Application Period: April 1 – May 1, 2026, at 5:00 p.m. Central Time
 * (closed)"). Read only when the card publishes no "Application Deadlines"
 * paragraph, so the label that already worked can never change its behaviour.
 */
const PERIOD_LABEL_RE = /\bApplication\s+Period\s*/i;

/** A month and day the source published WITHOUT a year of its own ("April 1"). */
const MONTH_DAY_NO_YEAR_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/;

/**
 * The Council's own "Application Period" value, read as the WINDOW it is.
 *
 * WHAT THE SOURCE PUBLISHED, AND WHAT IS DERIVED FROM ITS OWN WORDS:
 *   - `ends` / `endDay` / `startDay` — the value is split into its two ordered
 *     ends the same way South Carolina's period cell is (`publishedRangeEnds`),
 *     so the CLOSING end is the Council's own published close date and nothing is
 *     picked, averaged or interpolated. A value that is not exactly two ends, or
 *     whose closing end carries no exact year, yields no date at all.
 *   - `startDayYearFromClosingEnd` — the opening end publishes no year of its own
 *     ("April 1 – May 1, 2026"). Its year is read from the window's OWN closing
 *     end (the only year the source published in this value), preferring the year
 *     that keeps the range ASCENDING — which is what "April 1 – May 1" and
 *     "December 1 – January 15" both mean. It is used to confirm the range
 *     ascends and is kept in `raw` for a reviewer; it is NEVER written to the
 *     record's own `postedDate`/`closeDate`, and when the two ends do not ascend
 *     the whole window is refused (`orderedRange: false`, no date).
 *   - `declaresClosed` — the Council's own "(closed)" past tense on this value.
 *   - `declaresNoEndDate` — the source's own "no end date" wording, kept but
 *     never turned into a status here (the connector does not invent a rolling
 *     program it was not told about).
 */
export interface OklahomaApplicationPeriod {
  /** The Council's own value, verbatim. */
  value: string;
  /** Its two ordered ends, verbatim (empty when it is not a two-ended range). */
  ends: string[];
  /** The opening end as a day, or null (never a guess). */
  startDay: string | null;
  /** The closing end as a day — the window's published close date. */
  endDay: string | null;
  /** True only for a readable, ASCENDING two-ended range. */
  orderedRange: boolean;
  /** True when the opening end's year came from the window's own closing end. */
  startDayYearFromClosingEnd: boolean;
  /** The Council's own "(closed)" past tense on this value. */
  declaresClosed: boolean;
  /** The Council's own "no end date" wording on this value. */
  declaresNoEndDate: boolean;
}

export function readOklahomaApplicationPeriod(value: string): OklahomaApplicationPeriod {
  const range = publishedRangeEnds(value);
  const ends = range.parts;
  const endDay = range.openEnded ? null : range.endDay;
  let startDay = range.startDay;
  let startDayYearFromClosingEnd = false;
  if (startDay === null && endDay !== null) {
    const m = MONTH_DAY_NO_YEAR_RE.exec(stripTags(ends[0] ?? ""));
    if (m) {
      const monthDay = m[0].replace(/(st|nd|rd|th)\b/i, "");
      const endYear = Number(endDay.slice(0, 4));
      for (const year of [endYear, endYear - 1]) {
        const candidate = parseStateDay(`${monthDay}, ${year}`);
        if (candidate === null) continue;
        startDay = candidate;
        startDayYearFromClosingEnd = true;
        break;
      }
    }
  }
  const orderedRange = startDay !== null && endDay !== null && startDay <= endDay;
  return {
    value,
    ends,
    startDay: orderedRange ? startDay : null,
    endDay: orderedRange ? endDay : null,
    orderedRange,
    startDayYearFromClosingEnd: orderedRange && startDayYearFromClosingEnd,
    declaresClosed: declaresClosed(value),
    declaresNoEndDate: range.openEnded,
  };
}

/**
 * The Council's own value for one of its labelled paragraphs, read from the
 * paragraph that carries the label. Returns the raw value — never a date.
 */
function labelledParagraph(block: string, label: RegExp): string | null {
  for (const m of block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripTags(m[1] ?? "");
    const hit = label.exec(text);
    if (!hit) continue;
    const value = text.slice(hit.index + hit[0].length).replace(/^[\s:]+/, "").replace(/[\s.]+$/, "");
    if (value.length > 0) return value;
  }
  return null;
}

/** Parses ONE of the Council's program indexes into UNCLASSIFIED records. */
export function parseOklahomaProgramIndex(
  html: string,
  pageUrl: string,
  nextId: (base: string) => string = uniqueExternalIdFactory(),
): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(OKLAHOMA_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Oklahoma source payload is not the expected Oklahoma Arts Council program index (marker ${JSON.stringify(
        OKLAHOMA_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const starts = [...html.matchAll(CARD_SPLIT_RE)].map((m) => m.index ?? 0);
  const records: SourceGrantRecord[] = [];

  for (const [index, start] of starts.entries()) {
    const card = html.slice(start, starts[index + 1] ?? html.length);
    const titleEnd = card.indexOf(TITLE_END);
    const title = titleEnd === -1 ? "" : stripTags(card.slice(0, titleEnd));
    const body = card.slice(titleEnd === -1 ? 0 : titleEnd + TITLE_END.length);
    const deadlineValue = labelledParagraph(body, DEADLINE_LABEL_RE);
    // The Council's other own label for its application window, read only when
    // the card publishes no "Application Deadlines" paragraph (see the header).
    const periodValue = deadlineValue === null ? labelledParagraph(body, PERIOD_LABEL_RE) : null;
    const period = periodValue === null ? null : readOklahomaApplicationPeriod(periodValue);
    const activityPeriod = labelledParagraph(body, ACTIVITY_LABEL_RE);
    const amount = labelledParagraph(body, AMOUNT_LABEL_RE);
    // A card is a program when it names itself and publishes at least one of the
    // Council's own labelled facts — never a heading with nothing under it.
    if (title.length < 3) continue;
    if (deadlineValue === null && periodValue === null && activityPeriod === null && amount === null) {
      continue;
    }

    const windowText = deadlineValue ?? periodValue;
    const ongoing = windowText !== null && declaresOngoing(windowText);
    const sourceClosed =
      (deadlineValue !== null && declaresClosed(deadlineValue)) || period?.declaresClosed === true;
    const day = ongoing
      ? null
      : deadlineValue !== null
        ? singlePublishedDay(deadlineValue)
        : (period?.endDay ?? null);
    // The Council's own text that carries the window's closing end, from EITHER
    // of its two labels — the value a reviewer can check the date against.
    const closingText =
      deadlineValue ?? (period?.orderedRange === true ? (period.ends[1] ?? null) : null);
    const amounts = publishedAmountRange(amount ?? "");

    records.push({
      sourceKey: OKLAHOMA_CONNECTOR_ID,
      stateCode: "OK",
      externalId: nextId(title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")),
      title,
      agency: OKLAHOMA_AGENCY,
      summary: NOT_SPECIFIED,
      // The index the card was read from (both are the Council's own host). The
      // record's `sourceUrl` is ALWAYS the connector's declared source: the store
      // requires it to equal `state_grant_sources.official_url`, so a second index
      // page can never look like a second source.
      url: pageUrl,
      sourceUrl: OKLAHOMA_SOURCE_URL,
      // The Council publishes no OPENING date for these programs: the period
      // window's opening end is kept in `raw` only (see
      // readOklahomaApplicationPeriod) and never served as a posted date.
      postedDate: null,
      closeDate: day,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: amount ?? NOT_SPECIFIED,
      awardMinAmount: amounts.min,
      awardMaxAmount: amounts.max,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        deadlineValue,
        applicationDeadline: closingText,
        closingText,
        applicationDueDateText: closingText,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: sourceClosed,
        // The Council's own "Project Activity Dates" is the period the funded
        // ACTIVITY runs — it is never read, so it can never become a deadline.
        projectActivityDates: activityPeriod,
        projectActivityDatesIsNeverADeadline: true,
        deadlineIsARuleWhenNoDayParsed:
          deadlineValue !== null && day === null && !ongoing && !sourceClosed,
        cardPublishesNoApplicationDeadline: deadlineValue === null,
        // The window the card published under the Council's OTHER own label
        // ("Application Period"), when it published one (QA finding 2026-09-19).
        applicationPeriod: periodValue,
        applicationPeriodEnds: period?.ends ?? [],
        applicationPeriodStartDay: period?.startDay ?? null,
        applicationPeriodEndDay: period?.endDay ?? null,
        applicationPeriodEndDayIsTheClosingEndPublishedBySource: true,
        applicationPeriodIsOrderedRange: period?.orderedRange ?? false,
        applicationPeriodStartDayYearComesFromTheWindowsClosingEnd:
          period?.startDayYearFromClosingEnd ?? false,
        applicationPeriodClosedMarkerDeclaredBySource: period?.declaresClosed ?? false,
        applicationPeriodNoEndDateDeclaredBySource: period?.declaresNoEndDate ?? false,
        cardPublishesNoApplicationWindow: deadlineValue === null && periodValue === null,
        pagePublishesNoEligibilityOrAwardText: true,
      },
    });
  }
  return records;
}

/**
 * Parses the whole raw payload: the source's two program indexes, each fetched
 * fail-closed. A payload missing either page is a PARSE FAILURE (never a
 * half-read corpus).
 */
export function parseOklahomaGrantsPages(raw: string): SourceGrantRecord[] {
  const marker = "<!-- contrax:oklahoma-source-page-boundary -->";
  if (typeof raw !== "string" || !raw.includes(marker)) {
    throw new StateSourceError(
      "parse",
      `Oklahoma source payload is not the expected two-index payload (marker ${JSON.stringify(
        marker,
      )} missing)`,
    );
  }
  const pages = raw.split(/\n?<!-- contrax:oklahoma-source-page-boundary -->\n?/);
  const expected = OKLAHOMA_SOURCE_URLS.length;
  if (pages.length !== expected) {
    throw new StateSourceError(
      "parse",
      `Oklahoma source payload carried ${pages.length} program index(es), expected ${expected} — refusing to report a partially read source`,
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records = pages.flatMap((page, i) =>
    parseOklahomaProgramIndex(page, OKLAHOMA_SOURCE_URLS[i]!, nextId),
  );
  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Oklahoma source parsed to zero programs — the Council's program indexes changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/**
 * The classifier this connector uses. It is `classifyStateGrant()` — the owner's
 * status model, unmodified — plus ONE stricter rule the Council's own pages need.
 *
 * THE RULE: the Council's "(closed)" mark and its own published END DATE must
 * AGREE. `classifyStateGrant()` lets the source's past tense win outright, so a
 * card marked "(closed)" whose date is still AHEAD of us would be served `closed`
 * WITH a future closing date — a contradiction the source itself does not make.
 * Here the past tense still wins for the STATUS (that cycle is not accepting
 * applications, and it can never be served open), but a date that is still ahead
 * is WITHHELD rather than served as a deadline the Council's own words
 * contradict. The end day ITSELF is the window's last day, so it agrees and its
 * date is served. Everything else — including a passed published date with no
 * marker at all — is untouched, so this override is strictly less informative
 * than the shared classifier, never more.
 */
export function classifyOklahomaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  const classification = classifyStateGrant(record, now);
  if (classification.status !== "closed" || !record.sourceClosed) return classification;
  if (classification.closeDate === null) return classification;
  const endDay = stateDayEpoch(classification.closeDate);
  const today = easternDayStart(now);
  if (endDay === null || Number.isNaN(endDay) || Number.isNaN(today)) return classification;
  if (endDay <= today) return classification;
  return {
    status: "closed",
    postedDate: classification.postedDate,
    closeDate: null,
    estimatedCloseDate: null,
    reason:
      'the Council marks this cycle "(closed)" but its own end date is still ahead — the past tense wins for the status, so no disagreeing date is served',
  };
}

export const oklahomaConnector: StateGrantConnector<string> = {
  id: OKLAHOMA_CONNECTOR_ID,
  stateCode: "OK",
  stateName: "Oklahoma",
  sourceName: OKLAHOMA_SOURCE_NAME,
  agency: OKLAHOMA_AGENCY,
  sourceUrl: OKLAHOMA_SOURCE_URL,
  officialHost: OKLAHOMA_SOURCE_HOST,
  sourceValidationTest: OKLAHOMA_SOURCE_VALIDATION_TEST,
  async fetch() {
    // BOTH indexes, every run: the source is only complete with both, so either
    // page failing fails the whole state (fail-closed, checklist §4).
    const pages: string[] = [];
    for (const url of OKLAHOMA_SOURCE_URLS) {
      pages.push(
        await fetchStateGrantSource({
          url,
          marker: OKLAHOMA_CONTENT_MARKER,
          label: "Oklahoma",
          approvedHosts: OKLAHOMA_APPROVED_HOSTS,
        }),
      );
    }
    return pages.join(OKLAHOMA_PAGE_SEPARATOR);
  },
  parse(raw: string) {
    return parseOklahomaGrantsPages(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyOklahomaRecord(record, now);
  },
};
