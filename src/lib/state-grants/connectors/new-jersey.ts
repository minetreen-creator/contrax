/**
 * NEW JERSEY CONNECTOR — state grants NATIONWIDE workstream (owner correction
 * 2026-09-19, ratified 243: ONE continuous workstream, ONE accumulating PR).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://www.nj.gov/agriculture/financial-services/grants/
 *
 * WHY THIS URL, AND NOT THE RECON HANDOFF'S FIRST CANDIDATE
 *   The recon handoff proposed `nj.gov/dca/home/grants.shtml` (NJ Dept of
 *   Community Affairs) and its dhcr/grants child. Both were re-fetched live on
 *   2026-09-20 (40,148 B and 41,756 B): they publish NO grant record of their own.
 *   They are a POINTER at the DCA's SAGE system
 *   (`dcasage.intelligrants.com/RFPMailingRequest_List.asp`), which is a
 *   THIRD-PARTY, VENDOR-HOSTED system — explicitly out of scope for a state
 *   connector (a source must be the agency's own official host). The DCA/DHCR
 *   announcements index (verified the same day) is a NEWS list: its items are
 *   public hearings, a CAPER draft and an action-plan survey, and the one NOFO it
 *   carries (Atlantic City CoC) points applicants at a HUD federal NOFO PDF with
 *   no local application deadline. Neither would produce a single dated state
 *   grant, so neither earns a tier.
 *
 *   The official-source sweep the workstream requires then found the state's own
 *   grants directory — `grants.nj.gov` (301 → NJ Treasury Grants Management
 *   Office, `nj.gov/treasury/grants-management/opportunities/state`) — which
 *   lists each department's grant page. Of those 17 department pages, the NJDA
 *   page is the one that publishes a CURRENT, DATED notice-of-funding-availability
 *   list on the department's own host: NJDA is required by N.J.S.A. 52:14-34.5 to
 *   publish its NOFA, and its page says so in its own words ("The list that
 *   follows is the publication of NJDA notice of funding availability (NOFA) for
 *   purposes of N.J.S.A. 52:14-34.5").
 *
 * WHAT THE PAGE PUBLISHES (verbatim, its own bucket headings and labels)
 *   <section> per programme, grouped under the page's OWN bucket headings:
 *     "Open Opportunities"    — "currently open to new applications …"
 *     "Closed Opportunities"  — "currently closed to new applications …"
 *     "SADC Grant Opportunities" (State Agriculture Development Committee)
 *     "Other Funding Opportunities" — "not offered by the NJDA directly" ⇒ NEVER read
 *   Each programme section carries its own labelled fields (Purpose:, Eligible
 *   Applicants:, Funding Available:, How to Apply:, Program Webpage:, Contact:).
 *
 * HONESTY TRAPS HANDLED HERE
 *   - THE THIRD-PARTY BUCKET IS EXCLUDED BY CONSTRUCTION. The page says out loud
 *     that "Other Funding Opportunities" (American Farmland Trust, Fulfill, the
 *     Community FoodBank of NJ, the NJ Junior Breeder Loan Fund) are "not offered
 *     by the NJDA directly". They are counted and named in `raw`
 *     (`thirdPartyProgramsExcluded`) and never become records; the fixture test
 *     pins that none of their titles is served.
 *   - `closed` COMES ONLY FROM THE SOURCE'S OWN PAST-TENSE STATEMENT ("the
 *     application period … has officially closed"). A closed programme that also
 *     mentions a "rolling basis" (NJATP) stays `closed`: the past-tense statement
 *     wins, and the rolling wording is never promoted into `ongoing`.
 *   - `rolling` COMES ONLY FROM AN OPEN-ENDED DECLARATION the source makes for
 *     THAT programme ("There is no deadline to apply." / "may apply at any time,
 *     and applications are reviewed on a rolling basis."). Both such sections
 *     also publish a funding-availability DATE ("…available … after April 1,
 *     2025"; "…available until June 2027") — those are periods, not application
 *     deadlines, and every one of them is REFUSED verbatim into
 *     `raw.refusedDates`.
 *   - A DATED DEADLINE IS READ ONLY FROM THE PROGRAMME'S OWN SECTION, ONLY FROM
 *     THE SOURCE'S OWN LABEL ("no later than October 16, 2026" — the SCMP round),
 *     and only when the day parses exactly. Everything else date-like on the page
 *     is refused with a reason: the year-less email-timestamp cut-offs ("on or
 *     before July 31st, 12:00pm EDT", "after January 30th, 5 PM EST"), the
 *     funding-availability days, and the month-and-year "until June 2027" period.
 *   - NO INVENTED DATE. A programme the source lists as open with no published
 *     closing date (the Animal Waste Management Plan grant) is served
 *     `unverified` with `close_date = null` — the source declared it open, so it
 *     is served, and we still publish no deadline we were not given.
 *   - NARROW BY CONSTRUCTION: ONE department (NJDA, with the SADC programmes it
 *     publishes on the same page). Other New Jersey departments award grants we
 *     have NOT validated, so the state is `limited`, never `curated`/`connected`
 *     — this is not statewide coverage.
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
  fetchStateGrantSource,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";

export const NEW_JERSEY_SOURCE_URL = "https://www.nj.gov/agriculture/financial-services/grants/";
export const NEW_JERSEY_SOURCE_HOST = "www.nj.gov";
export const NEW_JERSEY_APPROVED_HOSTS: readonly string[] = ["www.nj.gov", "nj.gov"];
/** The publishing body, in the page's own words. */
export const NEW_JERSEY_AGENCY = "New Jersey Department of Agriculture";
export const NEW_JERSEY_SOURCE_NAME =
  "New Jersey Department of Agriculture — grant opportunities (NJDA notice of funding availability)";
export const NEW_JERSEY_CONNECTOR_ID = "nj-agriculture-grant-opportunities";
export const NEW_JERSEY_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/new-jersey.source-validation.test.ts";

/** A content marker only the real NJDA grants page carries (the page's own words). */
export const NEW_JERSEY_CONTENT_MARKER = "NJDA Grant Opportunities";
/** The page's own bucket headings — the ONLY source of a record's bucket. */
export const NEW_JERSEY_OPEN_HEADING = "Open Opportunities";
export const NEW_JERSEY_CLOSED_HEADING = "Closed Opportunities";
export const NEW_JERSEY_SADC_HEADING = "SADC Grant Opportunities";
export const NEW_JERSEY_THIRD_PARTY_HEADING = "Other Funding Opportunities";

type NewJerseyBucket = "open" | "closed" | "sadc" | "thirdParty" | "intro";

/** The label that opens each labelled field inside a programme section. */
const FIELD_LABELS = [
  "Purpose:",
  "Eligible Applicants:",
  "Funding Available:",
  "How to Apply:",
  "Program Webpage:",
  "Contact:",
] as const;

/**
 * The source's OWN deadline label. Only these phrasings, and only the FIRST one
 * in a programme's own section, may set a close date.
 */
const CLOSE_LABEL_RES: readonly RegExp[] = [
  /\bno\s+later\s+than\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/,
  /\bdue\s+on(?:\s+or\s+before)?\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/,
  /\bmust\s+be\s+submitted\s+by\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/,
  // The same two labels reworded with the time of day in between, which is how
  // the gleaning round publishes it: "no later than noon, 12:00 P.M., on July
  // 31st, 2026". The intervening text is capped so a label can never reach
  // across into a sentence about something else.
  /\bno\s+later\s+than\b[\s\S]{0,60}?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})/,
  /\bon\s+or\s+before\b[\s\S]{0,60}?([A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})/,
  // The source's own cut-off statement, which is a deadline in its own words:
  // "Applications received after November 30, 2024, will not be considered."
  // The date is read ONLY when the source's own sentence follows it, so the
  // encumbrance/expenditure days next to it are never deadlines.
  /\bapplications\s+received\s+after\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})\b[\s\S]{0,60}?\bwill\s+not\s+be\s+considered\b/i,
];
/** The source's own open-ended (rolling) declaration — per programme. */
const ROLLING_RES: readonly RegExp[] = [
  /\bthere\s+is\s+no\s+deadline\s+to\s+apply\b/i,
  /\bmay\s+apply\s+at\s+any\s+time\b[^.]{0,120}?\brolling\s+basis\b/i,
  /\bapplications\s+are\s+reviewed\s+on\s+a\s+rolling\s+basis\b/i,
];
/** The source's own past-tense closure statement. */
const SOURCE_CLOSED_RE =
  /\b(?:application\s+period|the\s+program\s+has|program\s+has|opportunity\s+is)\b[^.]{0,80}?\bclosed\b/i;
/** Any date-like token, for the refusal ledger (never a date by itself). */
const DATE_LIKE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\d{4})\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
/** A dollar amount the source itself published in its "Funding Available:" text. */
const DOLLAR_RE = /\$\s?([\d,]+(?:\.\d{2})?)/g;

/** One `<section>` of the page, classified by the page's own headings. */
interface PageSection {
  /** The programme's own title (accordion sections only), or null for a heading. */
  title: string | null;
  /** The heading text of a heading section ("Open Opportunities"), else null. */
  heading: string | null;
  /** The section's raw inner HTML. */
  html: string;
}

/** Splits the page's `<main>` into its `<section>` blocks, in document order. */
function pageSections(html: string): PageSection[] {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? html;
  const out: PageSection[] = [];
  for (const m of main.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)) {
    const block = m[1] ?? "";
    // A programme section is an ACCORDION section: its title is the span the
    // page wraps in `<span class="h4 mb-0">`. A bucket heading is a plain
    // `sectionTitle` h3 with no accordion button.
    const accordion = threadTitle(block);
    if (accordion !== null) {
      out.push({ title: accordion, heading: null, html: block });
      continue;
    }
    const headingMatch = /<h[1-6]\b[^>]*class="[^"]*sectionTitle[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(block);
    const heading = headingMatch === null ? null : collapse(stripTags(headingMatch[1] ?? ""));
    out.push({ title: null, heading: heading === "" ? null : heading, html: block });
  }
  return out;
}

/** The accordion section's own title, or null when the section is a heading. */
function threadTitle(block: string): string | null {
  if (!/accordion-header/i.test(block)) return null;
  const m = /<span\b[^>]*class="h4 mb-0"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
  const title = m === null ? "" : collapse(stripTags(m[1] ?? ""));
  return title === "" ? null : title;
}

/** The section's body as plain text (labels intact, whitespace collapsed). */
function sectionText(block: string): string {
  return collapse(stripTags(block));
}
function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The text between one label and the next label (or the end of the section). */
function fieldText(text: string, label: (typeof FIELD_LABELS)[number]): string | null {
  const start = text.indexOf(label);
  if (start < 0) return null;
  const from = start + label.length;
  let end = text.length;
  for (const other of FIELD_LABELS) {
    if (other === label) continue;
    const at = text.indexOf(other, from);
    if (at >= 0 && at < end) end = at;
  }
  const value = collapse(text.slice(from, end));
  return value === "" ? null : value;
}

/** The bucket a heading selects. Unknown headings keep the previous bucket out. */
function bucketForHeading(heading: string): NewJerseyBucket | null {
  if (heading === NEW_JERSEY_OPEN_HEADING) return "open";
  if (heading === NEW_JERSEY_CLOSED_HEADING) return "closed";
  if (heading === NEW_JERSEY_SADC_HEADING) return "sadc";
  if (heading === NEW_JERSEY_THIRD_PARTY_HEADING) return "thirdParty";
  return null;
}

/** The first official link the programme's own section publishes, if any. */
function programUrl(block: string): string | null {
  for (const m of block.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    const href = (m[1] ?? "").trim();
    if (href === "" || href.startsWith("#")) continue;
    if (/^(?:mailto|tel|javascript):/i.test(href)) continue;
    try {
      const resolved = new URL(href, NEW_JERSEY_SOURCE_URL);
      if (!NEW_JERSEY_APPROVED_HOSTS.includes(resolved.host)) continue;
      return resolved.toString();
    } catch {
      continue;
    }
  }
  return null;
}

/** A date-like token this connector deliberately does NOT read, with the reason. */
interface RefusedDate {
  text: string;
  kind: string;
  reason: string;
}

/** The refusal ledger for one programme section (never a close date). */
function refusedDates(text: string, readCloseDateText: string | null): RefusedDate[] {
  const out: RefusedDate[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DATE_LIKE_RE)) {
    const tokenText = collapse(m[0]);
    const readAsClose = readCloseDateText !== null && tokenText === collapse(readCloseDateText);
    if (readAsClose || seen.has(tokenText)) continue;
    seen.add(tokenText);
    const around = text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + tokenText.length + 60);
    const isAvailability = /\b(?:available|awarded|funds?|period\s+of\s+performance)\b/i.test(around);
    const hasYear = /\d{4}/.test(tokenText);
    // No year: does the token carry a DAY, or only a month (a period)?
    const hasDay = /\d{1,2}/.test(tokenText.replace(/^[A-Za-z.]+\s*/, ""));
    out.push({
      text: tokenText,
      kind: isAvailability
        ? "funding-availability"
        : hasYear
          ? "unlabelled"
          : hasDay
            ? "year-less"
            : "month-and-year",
      reason: isAvailability
        ? "a funding/availability period the source published, never an application deadline"
        : hasYear
          ? "date published by the source without an application-deadline label — refused rather than guessed"
          : hasDay
            ? "year-less date (no year to read) — refused rather than filled in"
            : "month-and-year only (a period, not a day) — refused rather than completed",
    });
  }
  return out;
}

/** The award wording and the arithmetic the source's own amounts support. */
function awardFields(fundingText: string | null): {
  range: string;
  min: number | null;
  max: number | null;
} {
  if (fundingText === null) return { range: NOT_SPECIFIED, min: null, max: null };
  const range = fundingText.length > 600 ? `${fundingText.slice(0, 600)}…` : fundingText;
  const amounts: number[] = [];
  for (const m of fundingText.matchAll(DOLLAR_RE)) {
    const n = Number((m[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) amounts.push(n);
  }
  const between = /\bbetween\s+\$[\d,]+(?:\.\d{2})?\s+and\s+\$[\d,]+(?:\.\d{2})?/i.test(fundingText);
  // Arithmetic only when the source's own wording supports ONE ceiling/range:
  // a single "up to $X" (one amount) or a single "between $A and $B" (two
  // amounts). Anything richer — per-county tiers, two application tracks, a
  // total allotment beside an award range — keeps the source's wording verbatim
  // with null amounts rather than a number we picked.
  if (between && amounts.length === 2) {
    return { range, min: Math.min(...amounts), max: Math.max(...amounts) };
  }
  if (/\bup\s+to\s+\$/i.test(fundingText) && amounts.length === 1) {
    return { range, min: null, max: amounts[0] ?? null };
  }
  return { range, min: null, max: null };
}

/**
 * Parses the NJDA grants page into UNCLASSIFIED records (one per programme
 * section the page publishes under a grant bucket it owns).
 */
export function parseNewJerseyGrantsPage(html: string): SourceGrantRecord[] {
  if (typeof html !== "string" || !html.includes(NEW_JERSEY_CONTENT_MARKER)) {
    throw new StateSourceError(
      "parse",
      `New Jersey source payload is not the expected NJDA grants page (marker ${JSON.stringify(
        NEW_JERSEY_CONTENT_MARKER,
      )} missing)`,
    );
  }
  const sections = pageSections(html);
  if (!sections.some((s) => s.heading === NEW_JERSEY_OPEN_HEADING)) {
    throw new StateSourceError(
      "parse",
      `New Jersey NJDA page parsed to zero sections with its own "${NEW_JERSEY_OPEN_HEADING}" heading — the page changed shape, refusing to report an empty corpus`,
    );
  }
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];
  const thirdPartyTitles: string[] = [];
  let bucket: NewJerseyBucket = "intro";

  for (const section of sections) {
    if (section.heading !== null) {
      bucket = bucketForHeading(section.heading) ?? "intro";
      continue;
    }
    if (section.title === null) continue;
    if (bucket === "thirdParty") {
      thirdPartyTitles.push(section.title);
      continue;
    }
    if (bucket !== "open" && bucket !== "closed" && bucket !== "sadc") continue;

    const text = sectionText(section.html);
    const readCloseText = readCloseDateLabel(text);
    const closeDate = readCloseText === null ? null : singlePublishedDay(readCloseText);
    const rolling = !isClosedText(text) && ROLLING_RES.some((re) => re.test(text));
    const sourceClosed = bucket === "closed";
    const funding = awardFields(fieldText(text, "Funding Available:"));
    const url = programUrl(section.html) ?? NEW_JERSEY_SOURCE_URL;
    const purpose = fieldText(text, "Purpose:");
    const applicants = fieldText(text, "Eligible Applicants:");
    const howToApply = fieldText(text, "How to Apply:");

    records.push({
      sourceKey: NEW_JERSEY_CONNECTOR_ID,
      stateCode: "NJ",
      externalId: nextId(`njda-${slug(section.title)}`),
      title: section.title,
      agency: NEW_JERSEY_AGENCY,
      summary: purpose ?? NOT_SPECIFIED,
      url,
      sourceUrl: NEW_JERSEY_SOURCE_URL,
      // The page publishes no posting or opening date for a programme; null.
      postedDate: null,
      closeDate,
      estimatedCloseDate: null,
      ongoing: rolling,
      sourceClosed,
      sourceUpdatedAt: null,
      eligibleApplicants: applicants ?? NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: funding.range,
      awardMinAmount: funding.min,
      awardMaxAmount: funding.max,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
      raw: {
        pageBucket: bucket,
        pageBucketHeading: bucketHeadingText(bucket),
        listedUnderOpenProgramsBySource: bucket === "open",
        // The close date is the source's own label inside THIS section, or none.
        closeDateLabelText: readCloseText,
        closeDateLabelReadFromThisProgramsOwnSection: true,
        howToApplyText: howToApply,
        rollingDeclaredBySource: rolling,
        rollingDeclarationText: rolling ? rollingText(text) : null,
        sourceClosedDeclaredBySource: sourceClosed,
        sourceClosedStatementText: sourceClosed ? closedText(text) : null,
        refusedDates: refusedDates(text, readCloseText),
        refusedDatesNeverCloseDates: true,
        thirdPartyProgramsExcluded: thirdPartyTitles,
        otherFundingOpportunitiesAreNotNjdaPrograms: true,
      },
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "New Jersey NJDA grants page parsed to zero programmes — refusing to report an empty corpus",
    );
  }
  return records;
}

function bucketHeadingText(bucket: NewJerseyBucket): string | null {
  switch (bucket) {
    case "open":
      return NEW_JERSEY_OPEN_HEADING;
    case "closed":
      return NEW_JERSEY_CLOSED_HEADING;
    case "sadc":
      return NEW_JERSEY_SADC_HEADING;
    case "thirdParty":
      return NEW_JERSEY_THIRD_PARTY_HEADING;
    default:
      return null;
  }
}

/** The source's own close-date label text inside one programme section. */
function readCloseDateLabel(text: string): string | null {
  for (const re of CLOSE_LABEL_RES) {
    const m = re.exec(text);
    if (m?.[1] !== undefined) return m[1];
  }
  return null;
}
function isClosedText(text: string): boolean {
  return SOURCE_CLOSED_RE.test(text);
}
function rollingText(text: string): string | null {
  for (const re of ROLLING_RES) {
    const m = re.exec(text);
    if (m !== null) return m[0];
  }
  return null;
}
function closedText(text: string): string | null {
  const m = SOURCE_CLOSED_RE.exec(text);
  return m === null ? null : collapse(m[0]);
}
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyNewJerseyRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const newJerseyConnector: StateGrantConnector<string> = {
  id: NEW_JERSEY_CONNECTOR_ID,
  stateCode: "NJ",
  stateName: "New Jersey",
  sourceName: NEW_JERSEY_SOURCE_NAME,
  agency: NEW_JERSEY_AGENCY,
  sourceUrl: NEW_JERSEY_SOURCE_URL,
  officialHost: NEW_JERSEY_SOURCE_HOST,
  sourceValidationTest: NEW_JERSEY_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantSource({
      url: NEW_JERSEY_SOURCE_URL,
      marker: NEW_JERSEY_CONTENT_MARKER,
      label: "New Jersey (NJDA)",
      approvedHosts: NEW_JERSEY_APPROVED_HOSTS,
    });
  },
  parse(raw: string) {
    return parseNewJerseyGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyNewJerseyRecord(record, now);
  },
};
