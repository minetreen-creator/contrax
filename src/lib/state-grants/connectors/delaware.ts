/**
 * DELAWARE CONNECTOR — state grants P3, batch #1 (owner rollout order
 * 2026-09-18; batch chosen, live-verified and fixture-saved 2026-09-19).
 *
 * OFFICIAL SOURCE (hard-coded): https://arts.delaware.gov/grants/
 * WHY THIS IS OFFICIAL: it is the **Delaware Division of the Arts** (the state
 * arts agency) publishing its own "Grant Programs Overview" on its own `.gov`
 * domain; it is a public server-rendered listing; it names each program with a
 * real, year-bearing deadline ("Next Deadline: March 1, 2027 at 4:30pm"); and it
 * needs no key. Verified live 2026-09-19 (HTTP 200, ~15 programs across four
 * audience groups); the fetched page is the saved fixture the unit tests parse
 * (`fixtures/delaware-arts.html`).
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: one Division, one page. Delaware's other
 * agencies are not validated, so the registry reports Delaware as `limited`,
 * never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE (from the batch source-verification report):
 *   - Year-less dates in program prose ("Applications open December 1") are NOT
 *     parsed. `singlePublishedDay()` matches year-bearing dates only, so those
 *     records stay `unverified` — no year is ever invented.
 *   - "Deadline: Rolling deadlines until funding expires." IS the source's own
 *     declaration that the program has no deadline → `rolling`, close date null.
 *   - The same program appears under TWO audience tabs ("Arts Access (ACC)" and
 *     "Education Resource (EDR)" are each listed twice, on the same URL). The
 *     program page is ONE record: the first occurrence wins, and the duplicate
 *     is dropped by URL here rather than being split into "…-2" rows.
 *   - A deadline paragraph is only read when it starts with a deadline label; the
 *     description prose (which also mentions "due" and "open") can never set a
 *     date, and the award figure is only taken from the source's own "up to $X"
 *     wording.
 *   - The audience group's own preamble ("Non-profit Delaware organizations
 *     whose primary mission is…") is the source's own eligibility statement, and
 *     it is stored verbatim as `eligibleApplicants` (never inferred). Geography,
 *     categories, total funding and match are all `NOT_SPECIFIED`/empty.
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
  officialUrl,
  singlePublishedDay,
  stripTags,
} from "~/lib/state-grants/connectors/source-support";

export const DELAWARE_SOURCE_URL = "https://arts.delaware.gov/grants/";
export const DELAWARE_SOURCE_HOST = "arts.delaware.gov";
export const DELAWARE_APPROVED_HOSTS: readonly string[] = [
  "arts.delaware.gov",
  "www.arts.delaware.gov",
];
export const DELAWARE_AGENCY = "Delaware Division of the Arts";
export const DELAWARE_SOURCE_NAME = "Delaware Division of the Arts — Grant Programs Overview";
export const DELAWARE_CONNECTOR_ID = "de-ddoa-grants";
export const DELAWARE_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/delaware.source-validation.test.ts";

/** The tab container that holds the program groups (record-level template). */
export const DELAWARE_CONTENT_MARKER = "wp-block-gic-tabs";

/** A paragraph that states a deadline, in the source's own labelling. */
const DEADLINE_LABEL_RE = /^(next deadline|deadline|due date|due|applications? due|cycle|letter of intent due)\b[:\s]*/i;

/**
 * Which labelled paragraph is the PROGRAM'S deadline when a program publishes
 * more than one. "StartUp Program" publishes both a prerequisite step
 * ("Letter of Intent due by January 15, 2027") and its own
 * "Next Deadline: March 1, 2027 at 4:30pm"; the source's own "Next Deadline"
 * line is the program's deadline, and the earlier paragraph is kept in `raw`.
 * (Nothing is combined or averaged: one published deadline, verbatim.)
 */
const DEADLINE_LABEL_PRIORITY = [/^next deadline\b/i, /^deadline\b/i, /^applications? due\b/i];

/** The source's own "up to $X" award wording (verbatim range + its ceiling). */
const UP_TO_RE = /\b(up to\s+\$[\d,]+(?:\.\d{2})?)/i;

interface Program {
  title: string;
  href: string | null;
  group: string | null;
  groupEligibility: string | null;
  paragraphs: string[];
}

interface Group {
  heading: string;
  /** The group's own preamble paragraph — its eligibility statement. */
  eligibility: string | null;
}

/**
 * Walks the tab region in document order, tracking the current audience group
 * (`h3`, whose first paragraph is the group's own eligibility statement) and the
 * current program (`h4` + its paragraphs). Only those three element types are
 * read, so navigation, sidebars and the page's script blocks can never become a
 * record.
 */
function readPrograms(region: string): Program[] {
  const tokenRe = /<h3[^>]*>([\s\S]*?)<\/h3>|<h4[^>]*>([\s\S]*?)<\/h4>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  const programs: Program[] = [];
  let group: Group | null = null;
  let current: Program | null = null;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(region)) !== null) {
    const raw = m[0];
    if (raw.startsWith("<h3")) {
      group = { heading: stripTags(m[1] ?? ""), eligibility: null };
      current = null;
      continue;
    }
    if (raw.startsWith("<h4")) {
      const inner = m[2] ?? "";
      const link = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
      if (!link) continue;
      const title = stripTags(link[2] ?? "");
      if (title.length < 3) continue;
      current = {
        title,
        href: link[1] ?? null,
        group: group?.heading ?? null,
        groupEligibility: group?.eligibility ?? null,
        paragraphs: [],
      };
      programs.push(current);
      continue;
    }
    const text = stripTags(m[3] ?? "");
    if (!text) continue;
    if (!current) {
      // Before the first program of a group: the group's own preamble.
      if (group && group.eligibility === null) group.eligibility = text;
      continue;
    }
    current.paragraphs.push(text);
  }
  return programs;
}

/** Parses the Grant Programs Overview page into UNCLASSIFIED records. */
export function parseDelawareGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(DELAWARE_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Delaware source payload is not the expected grants page (marker ${JSON.stringify(
        DELAWARE_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const start = html.indexOf(DELAWARE_CONTENT_MARKER);
  const end = html.indexOf("<footer", start);
  const region = html.slice(start, end === -1 ? undefined : end);
  const programs = readPrograms(region);
  if (programs.length === 0) {
    throw new StateSourceError(
      "parse",
      "Delaware source parsed to zero grant programs — the page layout changed, refusing to report an empty corpus",
    );
  }

  const seenUrls = new Set<string>();
  const records: SourceGrantRecord[] = [];

  for (const program of programs) {
    const url = officialUrl(program.href, {
      baseUrl: DELAWARE_SOURCE_URL,
      approvedHosts: DELAWARE_APPROVED_HOSTS,
      canonicalHost: DELAWARE_SOURCE_HOST,
    });
    // The same program is listed under two audience tabs on the same URL: one
    // program page is ONE record (first occurrence wins).
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const deadlineCandidates = program.paragraphs.filter((p) => DEADLINE_LABEL_RE.test(p));
    const deadlineText =
      DEADLINE_LABEL_PRIORITY.map((re) => deadlineCandidates.find((p) => re.test(p))).find(
        (p): p is string => typeof p === "string",
      ) ??
      deadlineCandidates[0] ??
      null;
    const description =
      program.paragraphs.find((p) => p !== deadlineText && !DEADLINE_LABEL_RE.test(p) && p.length > 20) ??
      "";
    const deadlineValue = deadlineText ? deadlineText.replace(DEADLINE_LABEL_RE, "").trim() : null;
    const closeDate = deadlineValue ? singlePublishedDay(deadlineValue) : null;
    const ongoing = deadlineText !== null && declaresOngoing(deadlineValue ?? "");
    const sourceClosed = deadlineText !== null && declaresClosed(deadlineValue ?? "");

    const awardMatch = UP_TO_RE.exec(description);
    const awardRange = awardMatch ? awardMatch[1] : NOT_SPECIFIED;
    const awardMax = awardMatch
      ? Number((awardMatch[1].replace(/[^0-9.]/g, "") || "0")) || null
      : null;

    const externalId =
      externalIdFromPath(url) ?? program.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    records.push({
      sourceKey: DELAWARE_CONNECTOR_ID,
      stateCode: "DE",
      externalId,
      title: program.title,
      agency: DELAWARE_AGENCY,
      summary: description || NOT_SPECIFIED,
      url,
      sourceUrl: DELAWARE_SOURCE_URL,
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: program.groupEligibility ?? NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange,
      awardMinAmount: null,
      awardMaxAmount: awardMax,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        audienceGroup: program.group,
        groupEligibility: program.groupEligibility,
        deadlineLabelText: deadlineText,
        deadlineParagraphsPublished: deadlineCandidates,
        deadlineValue,
        rollingDeclaredBySource: ongoing,
        awardPhraseFromSource: awardMatch ? awardMatch[1] : null,
      },
    });
  }
  return records;
}

export function classifyDelawareRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const delawareConnector: StateGrantConnector<string> = {
  id: DELAWARE_CONNECTOR_ID,
  stateCode: "DE",
  stateName: "Delaware",
  sourceName: DELAWARE_SOURCE_NAME,
  agency: DELAWARE_AGENCY,
  sourceUrl: DELAWARE_SOURCE_URL,
  officialHost: DELAWARE_SOURCE_HOST,
  sourceValidationTest: DELAWARE_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: DELAWARE_SOURCE_URL,
      marker: DELAWARE_CONTENT_MARKER,
      label: "Delaware",
    });
  },
  parse(raw: string) {
    return parseDelawareGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyDelawareRecord(record, now);
  },
};
