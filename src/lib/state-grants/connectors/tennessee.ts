/**
 * TENNESSEE CONNECTOR — state grants NATIONWIDE workstream, ESCALATION PASS
 * (owner escalation order 2026-09-19, checklist §0.5). Tennessee was one of the
 * 14 UNCERTAIN jurisdictions: phase 1 could not reach tnartscommission.org at
 * all (two connection errors), and the escalation re-probe (§③/④ conservative
 * parse of the agency's own listing) found a real, dated, cycle listing.
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://tnartscommission.org/art-grants/apply-for-a-grant/
 * WHY THIS IS OFFICIAL: it is the **Tennessee Arts Commission**'s own page — the
 * state agency that awards these grants — on its own domain (the same allowlist
 * class as vatc.org and arkansasheritage.com). It is plain server-rendered
 * WordPress HTML, needs no key, no login and no JavaScript, and the URL is that
 * page's own `<link rel="canonical">`. The page the connector reads is the
 * "Important Dates" list of the **current FY28 grant cycle**, which publishes one
 * dated milestone per line.
 *
 * THE PAGES THAT WERE REJECTED (documented; never re-proposed as the source):
 *   - https://tnartscommission.org/grants/ (linked from the nav as "Grant
 *     Opportunities"; its own `<title>` says "Grants Archive") — a real listing of
 *     18 programs WITH a closed/open filter, but it publishes **no date token at
 *     all** in the served HTML, so it can never yield an honest dated record.
 *   - https://tnartscommission.org/art-grants/ ("Grants") — the cycle overview;
 *     prose only, no per-program dates.
 *   - the enquiry pages (/app-review-process/, /manage-your-grant/) — process
 *     documentation, not an opportunity listing.
 *
 * ONE SOURCE IS NOT A STATEWIDE VIEW: this is ONE page of ONE agency. Tennessee
 * publishes funding through other departments we have NOT validated, and this
 * list covers only the Commission's own FY28 annual-grant cycle, so the registry
 * reports Tennessee as `limited`, never `connected`.
 *
 * HONESTY TRAPS HANDLED HERE
 *   - MILESTONES ARE NOT PROGRAMS, AND ANNOUNCEMENTS ARE NOT DEADLINES. The list
 *     carries six lines; only lines whose own words say a deadline ("… Applications
 *     Due") become a dated record. Two lines are NOT dates at all ("September 2026
 *     – … Guidelines Post", "March-April 2027 – … Panel Meetings"): a month, or a
 *     month RANGE, with no day can never become a day, and panel meetings are not
 *     something anyone applies to. They are skipped — never guessed at.
 *   - THE CYCLE-WIDE OPENING IS THE SOURCE'S OWN SEPARATE LINE. "October 9, 2026 –
 *     FY28 Annual Grant Applications Open" is published ONCE, for the FY28 annual
 *     grant cycle, and the three dated milestones on the same list are that
 *     cycle's programs ("FY28 Operating Support / Project Support / Individual
 *     Artist Fellowship Applications Due"). The connector therefore records that
 *     published OPENING day as each annual-grant record's opening date — it never
 *     invents an opening date, and it never pretends a cycle whose opening has not
 *     arrived is already accepting applications: the shared classifier reports
 *     those records `upcoming` until the source's own opening day (and `open`
 *     after it, because the closing date is published). Both dates come from this
 *     one list; the opening's own line is kept verbatim in `raw` on every record.
 *   - A LINE WITH NO PARSABLE DAY IS NEVER A RECORD. `singlePublishedDay()` refuses
 *     multi-day cells (Pennsylvania precedent), so if a future revision of this
 *     list puts two days on one line, that line becomes nothing rather than one
 *     arbitrary deadline.
 *   - The list publishes no eligibility, audience, award or match text, so every
 *     one of those fields stays `NOT_SPECIFIED`/empty — nothing is inferred from
 *     the rest of the page.
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
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const TENNESSEE_SOURCE_URL = "https://tnartscommission.org/art-grants/apply-for-a-grant/";
export const TENNESSEE_SOURCE_HOST = "tnartscommission.org";
export const TENNESSEE_APPROVED_HOSTS: readonly string[] = [
  "tnartscommission.org",
  "www.tnartscommission.org",
];
export const TENNESSEE_AGENCY = "Tennessee Arts Commission";
export const TENNESSEE_SOURCE_NAME =
  "Tennessee Arts Commission — Apply for a Grant (FY28 grant cycle important dates)";
export const TENNESSEE_CONNECTOR_ID = "tn-arts-commission-fy28-cycle-dates";
export const TENNESSEE_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/tennessee.source-validation.test.ts";

/** The listing's own heading — present only on the Apply for a Grant page. */
export const TENNESSEE_CONTENT_MARKER = "<h2>Important Dates</h2>";

/**
 * Where the dated list ends. `contentRegion` cuts at the FIRST occurrence after
 * the marker, and the dates `<ul>` is the first list after the heading (the nav
 * lists are far above the marker), so this boundary is the list's own close tag.
 */
export const TENNESSEE_REGION_END_MARKERS: readonly string[] = ["</ul>"];

const LIST_ITEM_RE = /<li>([\s\S]*?)<\/li>/gi;

/** The source's own words for a deadline, as opposed to an opening. */
const DUE_LABEL_RE = /\b(?:due|deadline)\b/i;
/** The source's own words for a cycle that has not opened yet. */
const OPENING_LABEL_RE = /\bopen(?:s|ing)?\b/i;
/** The separator the page uses between the day and what the day is for. */
const LABEL_SEPARATOR = " - ";
/** A trailing editorial note ("(NEW Earlier Deadline)") is not part of a name. */
const TRAILING_PARENTHETICAL_RE = /\s*\([^)]*\)\s*$/;

interface CycleLine {
  /** The line exactly as the source publishes it (entities decoded). */
  text: string;
  /** The one day the line publishes, or null when it publishes none/several. */
  day: string | null;
  /** The source's own label for the day, e.g. "FY28 Project Support Applications Due". */
  label: string;
  /** True when the line's own words are a closing, false when an opening. */
  isDeadline: boolean;
}

/**
 * Parses the "Important Dates" list into its source lines. Pure, and total: every
 * `<li>` becomes a `CycleLine`, including the ones that publish no day — the
 * caller decides what may become a record.
 */
export function parseTennesseeCycleDates(html: string): CycleLine[] {
  const region = contentRegion(html, TENNESSEE_CONTENT_MARKER, TENNESSEE_REGION_END_MARKERS);
  return [...region.matchAll(LIST_ITEM_RE)].map((m) => {
    const text = stripTags(m[1] ?? "");
    const day = singlePublishedDay(text);
    const separator = text.indexOf(LABEL_SEPARATOR);
    const label = separator === -1 ? text : text.slice(separator + LABEL_SEPARATOR.length);
    return {
      text,
      day,
      label: label.replace(TRAILING_PARENTHETICAL_RE, "").trim(),
      isDeadline: DUE_LABEL_RE.test(text),
    };
  });
}

/** Parses the FY28 cycle list into UNCLASSIFIED records. */
export function parseTennesseeGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(TENNESSEE_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Tennessee source payload is not the expected Apply for a Grant page (marker ${JSON.stringify(
        TENNESSEE_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const lines = parseTennesseeCycleDates(html);
  // The cycle-wide opening: the ONE published opening line on this list. It is
  // read here and (only) used as the opening date of the dated deadlines below —
  // see the header. A list without it simply yields deadlines with no opening.
  const openingLine =
    lines.find((l) => !l.isDeadline && l.day !== null && OPENING_LABEL_RE.test(l.text)) ?? null;
  // Every dated DEADLINE line becomes a record. A line with no day (a month, a
  // month range, a panel meeting) never does.
  const deadlineLines = lines.filter((l) => l.isDeadline && l.day !== null && l.label.length > 2);

  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = deadlineLines.map((line) => {
    const ongoing = declaresOngoing(line.text);
    return {
      sourceKey: TENNESSEE_CONNECTOR_ID,
      stateCode: "TN",
      externalId: nextId(slugify(line.label)),
      title: line.label,
      agency: TENNESSEE_AGENCY,
      summary: line.text,
      // There is no per-milestone page: the listing IS the source's page.
      url: TENNESSEE_SOURCE_URL,
      sourceUrl: TENNESSEE_SOURCE_URL,
      postedDate: openingLine?.day ?? null,
      closeDate: line.day,
      estimatedCloseDate: null,
      ongoing,
      sourceClosed: false,
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
        // The source's own line, verbatim — a reader can check every field above
        // against it without leaving the record.
        sourceLine: line.text,
        closingText: line.text,
        applicationDueDateText: line.text,
        deadlineLabel: line.label,
        cycle: "FY28",
        // The cycle's own opening line, kept verbatim (null when the list has
        // none). This is why `postedDate` above is not an invention.
        cycleOpeningText: openingLine?.text ?? null,
        cycleOpeningDayUsedAsOpeningDate: openingLine?.day ?? null,
        rollingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: false,
        // The list is a milestone calendar, not a program directory: it publishes
        // no eligibility/award/audience text at all.
        listPublishesProgramDetail: false,
      },
    };
  });

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Tennessee source parsed to zero dated deadlines — the Important Dates list changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

export function classifyTennesseeRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const tennesseeConnector: StateGrantConnector<string> = {
  id: TENNESSEE_CONNECTOR_ID,
  stateCode: "TN",
  stateName: "Tennessee",
  sourceName: TENNESSEE_SOURCE_NAME,
  agency: TENNESSEE_AGENCY,
  sourceUrl: TENNESSEE_SOURCE_URL,
  officialHost: TENNESSEE_SOURCE_HOST,
  sourceValidationTest: TENNESSEE_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: TENNESSEE_SOURCE_URL,
      marker: TENNESSEE_CONTENT_MARKER,
      label: "Tennessee",
      approvedHosts: TENNESSEE_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseTennesseeGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyTennesseeRecord(record, now);
  },
};
