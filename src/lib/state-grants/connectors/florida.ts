/**
 * FLORIDA CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR #408; build spec §C, FL).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://dos.fl.gov/cultural/grants/   — the Florida Department of State's
 *   Division of Arts and Culture grants index, on dos.fl.gov. Server-rendered
 *   HTML: no key, no login, no JavaScript.
 *
 * WHY THIS IS A MULTI-PAGE SOURCE. The index is a PROGRAM CATALOGUE: 27.9 KB
 * live, twenty-seven mentions of "grant", ZERO dates. Parsing it could only ever
 * produce undated records, which the build spec's rule A.2 says does NOT earn a
 * tier. Each grant programme the index publishes has its own page, and each of
 * those pages carries the Division's own per-programme application statement.
 * So this connector fetches the index plus the programme pages THE INDEX ITSELF
 * publishes (see `childUrls`) and reads every record from its OWN child page —
 * the District of Columbia NO-GO cause was a date inherited from the wrong
 * block, so page attribution is structural here.
 *
 * WHY THE CHILD URLS ARE SCOPED TO `/cultural/grants/grant-programs/<slug>/`:
 * the index also publishes `/cultural/grants/application-and-funding-process/`,
 * whose "Application Deadlines" heading carries ONE `deadline` token that is a
 * GENERAL statement about the whole catalogue ("2027-2028 Fiscal Year application
 * window is CLOSED for: General Program Support, …"). Spreading that single
 * token across the catalogue would attribute one general sentence to five
 * programmes, so that page is deliberately OUTSIDE the child scope: only the
 * programme pages themselves are read.
 *
 * THE PER-PROGRAMME STATEMENT, READ AS THE DIVISION WROTE IT (the honesty core):
 *   <h1>General Program Support</h1>
 *   <ul>
 *     <li><strong>Applications for Fiscal Year 2027-2028 are CLOSED</strong></li>
 *     <li><strong>Next Deadline: TBD</strong></li>
 *     <li><strong>Grant Period for Next Application Cycle: July 1, 2028 through June 30, 2029</strong></li>
 *   </ul>
 *   - "APPLICATIONS FOR FISCAL YEAR … ARE CLOSED" IS THE SOURCE'S OWN PAST-TENSE
 *     LABEL → `closed`, even though the page is live and the fiscal year name
 *     looks future.
 *   - "NEXT DEADLINE: TBD" IS NOT A DATE. The label is a deadline label, the
 *     value is the Division's own "TBD", so the record keeps NO close date and
 *     the sentence is carried verbatim in `raw` for review. Nothing is guessed
 *     from it and it is never spread across other programmes.
 *   - "GRANT PERIOD FOR NEXT APPLICATION CYCLE: July 1, 2028 through June 30,
 *     2029" IS AN ACTIVITY PERIOD, NEVER A DEADLINE. Those are the 2028/2029
 *     dates that made this source look dated: they are the period the money
 *     covers, not the day an application is due. The period is carried verbatim
 *     in `raw.grantPeriodText` and never becomes a posted or close date. (This
 *     is the "decide grant-period vs deadline from the LABEL before reading"
 *     rule from the build spec.)
 *   - "THE APPLICATION CYCLE FOR THIS PROGRAM HAS CLOSED" is the same past-tense
 *     statement in prose (the America 250 programme page), so that programme is
 *     `closed` too.
 *   - A PAGE THAT PUBLISHES NO APPLICATION STATEMENT CONTRIBUTES NO RECORD. The
 *     Cultural Endowment page is programme history ("The purpose of the Cultural
 *     Endowment Program was …") with no application status and no dated cycle, so
 *     it is not turned into an undated record to pad the corpus.
 *
 * NARROW BY CONSTRUCTION. This is ONE division's (the Division of Arts and
 * Culture, Florida Department of State) grant programmes. Other Florida agencies
 * award grants we have NOT validated, so the state is `limited` — never
 * `curated`/`connected`, and the registry note says this is not statewide
 * coverage.
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
  decodeEntities,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";

export const FLORIDA_SOURCE_URL = "https://dos.fl.gov/cultural/grants/";
export const FLORIDA_SOURCE_HOST = "dos.fl.gov";
export const FLORIDA_APPROVED_HOSTS: readonly string[] = ["dos.fl.gov", "www.dos.fl.gov"];
/** The publishing body, in the pages' own breadcrumb words. */
export const FLORIDA_AGENCY = "Division of Arts and Culture";
export const FLORIDA_SOURCE_NAME = "Florida Division of Arts and Culture — Grant Programs";
export const FLORIDA_CONNECTOR_ID = "fl-dos-cultural-grants";
export const FLORIDA_SOURCE_VALIDATION_TEST = "src/lib/state-grants/florida.source-validation.test.ts";

/** The index's own content marker: the body that publishes the catalogue. */
export const FLORIDA_INDEX_MARKER = "Division of Arts and Culture";
/** Every fetched page carries this (the Division's breadcrumb) — the child marker. */
export const FLORIDA_PAGE_MARKER = "Division of Arts and Culture";
/** Only the grant PROGRAMME pages are read — never the funding-process page. */
export const FLORIDA_PROGRAM_PATH_PREFIX = "/cultural/grants/grant-programs/";
/** The index publishes five programme pages today; more than this fails loudly. */
export const FLORIDA_MAX_CHILD_PAGES = 12;

/** The Division's own per-programme application-status sentence. */
export const FLORIDA_STATUS_MARKER = "Applications for Fiscal Year";
/** The prose form of the same statement (America 250 programme page). */
export const FLORIDA_CYCLE_CLOSED_SENTENCE = "The application cycle for this program has CLOSED.";
/** The label whose value is a deadline — held for review, never broadcast. */
export const FLORIDA_DEADLINE_LABEL = "Next Deadline";
/** The label whose value is an ACTIVITY PERIOD — never a deadline. */
export const FLORIDA_GRANT_PERIOD_LABEL = "Grant Period";
/** A value the Division marks as an estimate goes to `estimatedCloseDate`, never `closeDate`. */
const ESTIMATE_MARKER_RE = /\b(estimated|anticipated|expected|tentative)\b/i;

const ANCHOR_RE = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/** One grant programme the index publishes: its page URL and the index's own name. */
export interface FloridaGrantProgram {
  /** Absolute URL on the approved host (normalised to dos.fl.gov). */
  url: string;
  /** The index's own link text for the programme, e.g. "General Program Support". */
  name: string;
  /** The page's slug inside the grant-programs path, e.g. "general-program-support". */
  slug: string;
}

/**
 * Every grant PROGRAMME page the index publishes, in the index's own document
 * order. A link that leaves the grant-programs path prefix, the approved hosts,
 * or is the path's own hub (`/cultural/grants/grant-programs/` itself) is not a
 * programme page, and the funding-process / resources / managing-your-grants
 * pages are outside the prefix by construction.
 */
export function floridaGrantPrograms(indexHtml: string): FloridaGrantProgram[] {
  const out: FloridaGrantProgram[] = [];
  const seen = new Set<string>();
  for (const m of indexHtml.matchAll(new RegExp(ANCHOR_RE.source, "gi"))) {
    const href = decodeEntities(m[1] ?? "").trim();
    const name = stripTags(m[2] ?? "");
    if (href.length === 0 || name.length === 0) continue;
    let url: URL;
    try {
      url = new URL(href, FLORIDA_SOURCE_URL);
    } catch {
      continue;
    }
    if (!FLORIDA_APPROVED_HOSTS.includes(url.host)) continue;
    if (!url.pathname.startsWith(FLORIDA_PROGRAM_PATH_PREFIX)) continue;
    const slug = url.pathname.slice(FLORIDA_PROGRAM_PATH_PREFIX.length).replace(/^\/+|\/+$/g, "");
    if (slug.length === 0 || slug === "index" || slug.includes("/")) continue;
    if (url.host === "www.dos.fl.gov") url.host = "dos.fl.gov";
    url.hash = "";
    url.search = "";
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, name, slug });
  }
  return out;
}

// ── The Division's own per-programme statement ──────────────────────────────

/** One `<li><strong>Label</strong></li>` item of a programme's own statement list. */
interface StatementItem {
  text: string;
}

const STATEMENT_ITEM_RE = /<li\b[^>]*>\s*<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
/** "Applications for Fiscal Year 2027-2028 are CLOSED". */
const FISCAL_STATUS_RE = /^Applications?\s+for\s+Fiscal\s+Year\s+([\d]{4}\s*[-–—]\s*[\d]{4}|[\d]{4})\s+are\s+(.+?)$/i;
const STATUS_WORD_RE = /\b(now open|open|closed|not open|no longer accepting)\b/i;

/** The `Label: value` split of one statement item (the Division's own two parts). */
function splitLabel(item: string): { label: string; value: string } {
  const m = /^([^:]{1,80}):\s*([\s\S]*)$/.exec(item);
  if (m === null) return { label: item.trim(), value: "" };
  return { label: (m[1] ?? "").trim(), value: (m[2] ?? "").trim() };
}

/** The page's own h1 (the programme name the Division publishes for it). */
function floridaPageTitle(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const text = m ? stripTags(m[1] ?? "") : "";
  return text.length > 0 ? text : null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Parses the index + programme pages into UNCLASSIFIED records — one per
 * published grant programme that carries the Division's own application
 * statement. Every value comes from that programme's own page.
 */
export function parseFloridaCulturalGrants(payload: string): SourceGrantRecord[] {
  if (typeof payload !== "string" || !payload.includes(FLORIDA_INDEX_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Florida source payload is not the expected Division of Arts and Culture grants corpus (marker ${JSON.stringify(
        FLORIDA_INDEX_MARKER,
      )} missing)`,
    );
  }
  const pages = splitSourcePages(payload);
  const indexPage =
    pages.find((p) => p.url === FLORIDA_SOURCE_URL) ??
    pages.find((p) => floridaGrantPrograms(p.html).length > 0);
  const programs = indexPage ? floridaGrantPrograms(indexPage.html) : [];
  const nameByUrl = new Map(programs.map((p) => [p.url, p.name] as const));
  const slugByUrl = new Map(programs.map((p) => [p.url, p.slug] as const));
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const page of pages) {
    // The index itself publishes no dated listing, and a page we cannot
    // attribute to a URL is not part of this corpus.
    if (page.url.length === 0 || page.url === FLORIDA_SOURCE_URL) continue;
    const items: StatementItem[] = [];
    for (const m of page.html.matchAll(new RegExp(STATEMENT_ITEM_RE.source, "gi"))) {
      const text = stripTags(m[1] ?? "").trim();
      if (text.length > 0) items.push({ text });
    }
    const fiscalItem = items.find((i) => FISCAL_STATUS_RE.test(i.text)) ?? null;
    const deadlineItem = items.find((i) => splitLabel(i.text).label === FLORIDA_DEADLINE_LABEL) ?? null;
    const periodItem =
      items.find((i) => splitLabel(i.text).label.startsWith(FLORIDA_GRANT_PERIOD_LABEL)) ?? null;
    const proseClosed = page.html.includes(FLORIDA_CYCLE_CLOSED_SENTENCE);
    // A programme with no application statement at all is programme history, not
    // an opportunity: it contributes NO record (never an undated one).
    if (fiscalItem === null && !proseClosed) continue;

    const fiscalMatch = fiscalItem === null ? null : FISCAL_STATUS_RE.exec(fiscalItem.text);
    const statusWord = fiscalMatch === null ? null : (STATUS_WORD_RE.exec(fiscalMatch[2] ?? "")?.[1] ?? null);
    const sourceClosed =
      (statusWord !== null && /\bclosed\b/i.test(statusWord)) || (fiscalMatch === null && proseClosed);
    const deadlineValue = deadlineItem === null ? null : splitLabel(deadlineItem.text).value;
    const periodValue = periodItem === null ? null : splitLabel(periodItem.text).value;
    // The deadline label's OWN value, and nothing else, can become a date:
    // "TBD" (or any unreadable value) yields NO date rather than a guess, and a
    // value the Division marks as an estimate can only ever be an estimate.
    const dayFromValue = deadlineValue === null ? null : singlePublishedDay(deadlineValue);
    const valueIsEstimate = deadlineValue !== null && ESTIMATE_MARKER_RE.test(deadlineValue);
    const closeDay = valueIsEstimate ? null : dayFromValue;
    const estimateDay = valueIsEstimate ? dayFromValue : null;
    const title = floridaPageTitle(page.html) ?? nameByUrl.get(page.url) ?? null;
    if (title === null) continue;
    const slug = slugByUrl.get(page.url) ?? slugify(title);
    const idBase = slug;

    records.push({
      sourceKey: FLORIDA_CONNECTOR_ID,
      stateCode: "FL",
      externalId: nextId(idBase),
      title,
      agency: FLORIDA_AGENCY,
      summary: NOT_SPECIFIED,
      // The programme page that published the statement — never the index.
      url: page.url,
      sourceUrl: FLORIDA_SOURCE_URL,
      // The Division publishes no opening day on these pages: nothing is invented.
      postedDate: null,
      closeDate: closeDay,
      estimatedCloseDate: estimateDay,
      // The Division publishes no "rolling"/year-round wording for these programmes.
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
        childPageUrl: page.url,
        programName: nameByUrl.get(page.url) ?? title,
        // The Division's own application-status sentence, verbatim.
        statusText: fiscalItem?.text ?? (proseClosed ? FLORIDA_CYCLE_CLOSED_SENTENCE : null),
        fiscalYearLabel: fiscalMatch?.[1]?.replace(/\s+/g, "") ?? null,
        statusWord,
        sourceClosedDeclaredBySource: sourceClosed,
        // The deadline LABEL and its own value, verbatim ("TBD" is not a date).
        deadlineLabelText: deadlineItem?.text ?? null,
        nextDeadlineText: deadlineValue,
        closingText: deadlineValue,
        closingDayPublishedBySource: closeDay,
        deadlineValueIsNeverSpreadAcrossOtherPrograms: true,
        deadlineValueTbdIsNotADate: deadlineValue === null || /\bTBD\b/i.test(deadlineValue),
        deadlineValueIsAnEstimate: valueIsEstimate,
        estimateIsNeverADeadline: true,
        // The activity period, carried for review and NEVER used as a date.
        grantPeriodText: periodValue,
        grantPeriodIsNeverADeadline: true,
        datesReadOnlyFromThisProgramsOwnPage: true,
        rollingDeclaredBySource: false,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Florida Division of Arts and Culture programme pages parsed to zero application statements — the pages changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyFloridaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const floridaConnector: StateGrantConnector<string> = {
  id: FLORIDA_CONNECTOR_ID,
  stateCode: "FL",
  stateName: "Florida",
  sourceName: FLORIDA_SOURCE_NAME,
  agency: FLORIDA_AGENCY,
  sourceUrl: FLORIDA_SOURCE_URL,
  officialHost: FLORIDA_SOURCE_HOST,
  sourceValidationTest: FLORIDA_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantPages({
      indexUrl: FLORIDA_SOURCE_URL,
      marker: FLORIDA_INDEX_MARKER,
      childMarker: FLORIDA_PAGE_MARKER,
      label: "Florida Division of Arts and Culture grants",
      approvedHosts: FLORIDA_APPROVED_HOSTS,
      minBytes: 4000,
      childMinBytes: 4000,
      maxChildren: FLORIDA_MAX_CHILD_PAGES,
      childUrls: (indexHtml) => floridaGrantPrograms(indexHtml).map((p) => p.url),
    });
  },
  parse(raw: string) {
    return parseFloridaCulturalGrants(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyFloridaRecord(record, now);
  },
};
