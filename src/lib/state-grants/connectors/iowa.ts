/**
 * IOWA STATE GRANTS CONNECTOR — Iowa Economic Development Authority / Iowa Arts
 * Council, "Grants & Programs" programme pages (opportunityiowa.gov).
 *
 * WHY THIS SOURCE, AND WHY THE 301 TARGET IS READ DIRECTLY. Iowa's arts agency
 * URL (`iowaculture.gov/grants`) 301s OFF-HOST onto `opportunityiowa.gov`, and
 * the live fetch harness refuses an off-allowlist redirect. So the connector
 * hard-codes the FINAL host and path the redirect lands on and allowlists only
 * `opportunityiowa.gov`. The "off-host redirect" rule is therefore asserted as
 * "every record's URL is on the final host", never by replaying the redirect.
 *
 * WHY THE PROGRAMME LIST IS PINNED RATHER THAN SCRAPED. The catalogue
 * (`.../arts-culture/grants-programs`) renders 21 tiles across three pages of a
 * Drupal view; its own tiles duplicate the programme pages, it publishes NO date
 * token of its own, and one of the pages it links is a support FAQ rather than a
 * grant programme. A link-derived child list would also pick up the whole
 * arts-culture section (events, artist retreats, Poetry Out Loud). The 18 pages
 * below are pinned; the fan-out is bounded by that list.
 *
 * WHAT THE SOURCE ACTUALLY PUBLISHES (verified live 2026-09-19), and what is
 * therefore refused as a deadline. Every record is read from ONE programme
 * page's OWN body region (`field--name-field-basic-page__body`) — never from the
 * catalogue, never from the site's navigation or footer furniture:
 *   - Mural program: `<h2>Application Process</h2><h3>Communities</h3>
 *     <ul><li>Deadline: October 28, 2026</li>…` and a second `<h3>Artists</h3>`
 *     block with `<li>Deadline: October 30, 2026</li>`. Two labelled deadlines
 *     for two applicant ROLES ⇒ two records, each titled with the agency's own
 *     role heading (the Indiana/Vermont row-scoped precedent).
 *   - Scholarship: `<h2>Timeline</h2><ul><li>April 1, 2026 | Fiscal Year 2025
 *     Application Deadline<br>The deadline to submit an online application is
 *     11:59 PM on April 1, 2026.</li>…` — a labelled deadline. The SAME list's
 *     next two entries are `Finalist Applicant Interviews` and `Award
 *     Notification`: process milestones, REFUSED.
 *   - Artist Fellowship: "The deadline for submitting an online application is
 *     11:59PM on April 1, 2026." — the agency's own sentence.
 *   - Film Rebate: "Applications for the Film Rebate program will be accepted
 *     from February 2, 2026, through March 16, 2026." — a labelled window.
 *   - Artist Professional Development Grant and the Art Project Grant's Creative
 *     Abundance special round: "Applications will be accepted on a rolling basis
 *     until April 15, 2027 or until funds are expended." — the source's own
 *     rolling declaration ⇒ `rolling` with NO close date (the "until" day is the
 *     end of an open acceptance, not a deadline this connector may expire). The
 *     same pages' "funding period July 1, 2026 - June 30, 2027" is a PERIOD OF
 *     PERFORMANCE and their "August 2, 2027 | Final Report Deadline" binds
 *     GRANTEES, not applicants: both REFUSED and recorded under `refusedDates`.
 *   - Twelve programmes publish "Program is not currently accepting
 *     applications." / "…will not be accepting applications." in their own words
 *     ⇒ `closed` with NO date (the agency's words win; nothing is inferred).
 *   - Creative Places Accelerator publishes only a `Program Timeline` (a
 *     period), and the Art Project Grant / Screenwriters pages publish no window
 *     of their own ⇒ `unverified`, never a guessed cycle.
 * NARROW BY CONSTRUCTION. This is ONE agency's arts-and-culture programme
 * catalogue of ONE state. Iowa awards grants through other departments
 * (transportation, natural resources, public health) and through local bodies we
 * have NOT validated, so the state is `limited` — never `curated`/`connected`.
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
  externalIdFromPath,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";
/** The catalogue the connector fetches FIRST (the listing it names as `listedBy`). */
export const IOWA_SOURCE_URL =
  "https://opportunityiowa.gov/community/arts-culture/grants-programs";
/** The FINAL host the off-host `iowaculture.gov/grants` redirect lands on. */
export const IOWA_SOURCE_HOST = "opportunityiowa.gov";
export const IOWA_APPROVED_HOSTS: readonly string[] = [
  "opportunityiowa.gov",
  "www.opportunityiowa.gov",
];
/** The publishing body, in the pages' own words. */
export const IOWA_AGENCY = "Iowa Economic Development Authority";
export const IOWA_SOURCE_NAME =
  "Iowa Economic Development Authority (Iowa Arts Council) — Grants & Programs programme pages";
export const IOWA_CONNECTOR_ID = "ia-arts-council-grants";
export const IOWA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/iowa.source-validation.test.ts";
/**
 * The catalogue's own Drupal view machine name — the listing's results block,
 * and the one string the listing carries that no programme page does (verified
 * live 2026-09-19: present on the listing, absent from all 20 programme pages).
 * It is the listing's identity, and no record is ever read from it.
 */
export const IOWA_INDEX_MARKER = "view-id-listing_page_blocks";
/** The body region every programme page publishes (and the listing does not). */
export const IOWA_CHILD_MARKER = "field--name-field-basic-page__body";
/**
 * The programme pages this connector reads, in the catalogue's own order and
 * with the catalogue's own paths. Two of the catalogue's 21 tiles are NOT read:
 *   - `artist-professional-development-grant/…-program-guidelines` restates the
 *     window its programme page already publishes, so reading both would serve
 *     two rows for one application (duplicate coverage).
 *   - `reimbursements-and-final-reports-faq` is a grantee support FAQ, not a
 *     funding programme, and publishes no window.
 * The Art Project Grant's Creative Abundance special round IS read (it is a
 * distinct application round whose parent page publishes no window of its own).
 */
export const IOWA_PROGRAMME_PATHS: readonly string[] = [
  "/community/arts-culture/grants-programs/art-project-grant",
  "/community/arts-culture/grants-programs/art-project-grant/art-project-grant-organizations-program-guidelines-creative-abundance-special-round",
  "/community/arts-culture/grants-programs/artist-fellowship-program",
  "/community/arts-culture/grants-programs/artist-professional-development-grant",
  "/community/arts-culture/grants-programs/creative-places-accelerator",
  "/community/arts-culture/grants-programs/cultural-capacity-building-grant",
  "/community/arts-culture/grants-programs/cultural-leadership-partners",
  "/community/arts-culture/grants-programs/greenlight-grant",
  "/community/arts-culture/grants-programs/inspire-iowa",
  "/community/arts-culture/grants-programs/iowa-artist-career-accelerator",
  "/community/arts-culture/grants-programs/iowa-certified-film-festivals-grant",
  "/community/arts-culture/grants-programs/iowa-culture-leadership-cohort",
  "/community/arts-culture/grants-programs/iowa-film-rebate-program",
  "/community/arts-culture/grants-programs/iowa-scholarship-arts",
  "/community/arts-culture/grants-programs/iowa-screenwriters-grant",
  "/community/arts-culture/grants-programs/iowa-traditional-arts-apprenticeship-grant",
  "/community/arts-culture/grants-programs/iowans-create-community-mural-program",
  "/community/arts-culture/grants-programs/partnership-grant",
];
/** Today the connector reads 18 programme pages; more than this fails loudly. */
export const IOWA_MAX_CHILD_PAGES = IOWA_PROGRAMME_PATHS.length;
/** The absolute URL of every pinned programme page. */
export const IOWA_CHILD_PAGES: readonly string[] = IOWA_PROGRAMME_PATHS.map(
  (path) => `https://${IOWA_SOURCE_HOST}${path}`,
);
/** The path prefix stripped when deriving a record's own id from its page URL. */
const IOWA_ID_PREFIXES = ["community/arts-culture/grants-programs"] as const;

// ── The source's own date grammar ───────────────────────────────────────────
const MONTH_SOURCE =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
/** One source-published day: "October 28, 2026" (a full month, as Iowa writes it). */
const DAY_SOURCE = `(${MONTH_SOURCE})\\s+(\\d{1,2}),\\s+(\\d{4})`;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The headings the connector reads a section from, marked inside the flat text. */
const H2_OPEN = "\u0003";
const H2_CLOSE = "\u0004";
/**
 * A heading that introduces a LIST is a candidate ROLE heading: the agency's
 * Application Process section is written as `<h3>Communities</h3><ul><li>Deadline:
 * …</li>`, one block per applicant role. A single candidate under Application
 * Process is a TOPIC heading rather than a role — the Fellowship page writes
 * `<h3>Timeline</h3><ul><li>The deadline for submitting …`, and "Timeline" must
 * never become part of a record's title. So a role is read only where the agency
 * ENUMERATES its applicant blocks (two or more candidates); see `iowaWindows`.
 */
const ROLE_OPEN = "\u0001";
const ROLE_CLOSE = "\u0002";
/** The one section whose headings name an APPLICANT ROLE rather than a topic. */
const ROLE_SECTION = "Application Process";
/** Removes the internal heading marks from any string a user may ever read. */
function unmark(text: string): string {
  return text.replace(/[\u0001-\u0004]/g, " ").replace(/\s+/g, " ").trim();
}
/** A labelled deadline written as `Deadline: <date>`. */
const COLON_DEADLINE_RE = new RegExp(`\\bDeadline\\s*:\\s*${DAY_SOURCE}`, "gi");
/** A labelled deadline written as `<date> | <label>` (the Timeline lists). */
const PIPE_RE = new RegExp(`(${DAY_SOURCE})\\s*\\|\\s*([^|]{0,90})`, "gi");
/** The agency's own sentence form: "The deadline for submitting … is … on <date>". */
const PROSE_DEADLINE_RE = new RegExp(
  `\\bdeadline (?:for|to) submitt?[a-z]*[^.]{0,40}?on ${DAY_SOURCE}`,
  "gi",
);
/** A published acceptance window: "accepted from <date> through <date>". */
const ACCEPT_WINDOW_RE = new RegExp(`accepted from ${DAY_SOURCE},? through ${DAY_SOURCE}`, "gi");
/** The source's own rolling declaration, with the day it ends. */
const ROLLING_RE = new RegExp(`accepted on a rolling basis until ${DAY_SOURCE}`, "gi");
/** A bare rolling statement with no day at all. */
const ROLLING_BARE_RE = /\brolling basis\b/i;
/** The agency's own words for "this programme is not taking applications". */
const NOT_ACCEPTING_RE = /not\s+(?:currently\s+|be\s+)?accepting applications/i;
/**
 * Modifiers that turn a `Deadline` into something that is NOT an application
 * deadline (a report a GRANTEE owes, a review milestone, a purchase order).
 */
const REFUSED_MODIFIER_RE =
  /\b(Final Report|Final Reports|Reimbursement|Letter of Intent|Anticipated|Performance|Award Notification|Applicant Interviews?|Contract Term|Purchase)\b/i;
/** Labels that name a deadline this connector may READ (an applicant deadline). */
const ACCEPT_LABEL_RE = /\bDeadline\b/i;
/**
 * Labels that name a date this connector must REFUSE: something that binds a
 * grantee, a reviewer or a funding period rather than an applicant's submission.
 */
const REFUSED_LABEL_RE =
  /\b(Funding Period|Period of Performance|Final Report|Finalist|Interviews?|Award|Notification|Reimbursement|Term|Schedule|Milestone)\b/i;
/**
 * Phrases that REFUSE every date near them: award timing, letters of intent,
 * periods of performance, contract terms, grantee reporting and the agency's own
 * fund-availability prose. None of these is an application deadline, and Iowa
 * publishes all of them on live programme pages.
 */
const REFUSED_PHRASES: readonly string[] = [
  "Anticipated Award",
  "Letter of Intent",
  "Period of Performance",
  "Contract Term",
  "Award Amount",
  "Eligible Funding Period",
  "funding period",
  "Final Report",
  "Final reports",
  "is available through this fund through",
  "expended between date of contract execution and",
];
/** One window a programme page publishes. */
export interface IowaWindow {
  /** The agency's own role heading for this window, or null. */
  role: string | null;
  /** The agency's own label for it, verbatim (`Deadline`, `Application Deadline`). */
  label: string;
  /** The agency's own date phrase, verbatim. */
  closingText: string;
  closeDate: string | null;
  openDate: string | null;
  /** The agency's own opening-date phrase, verbatim, or null. */
  openText: string | null;
  /** True when the agency declares the programme open-ended in its own words. */
  rolling: boolean;
  /** The agency's own rolling sentence, verbatim, or null. */
  rollingSentence: string | null;
}
/** Everything one programme page publishes about its application status. */
export interface IowaPageWindows {
  windows: IowaWindow[];
  /** The agency's own "not accepting applications" sentence, or null. */
  closedSentence: string | null;
  /** Labels whose dates were refused, verbatim, for a reviewer. */
  refused: string[];
}
/** Turns a month name and a day into `YYYY-MM-DD`, or null when it is not a day. */
function isoDay(monthName: string, dayText: string, yearText: string): string | null {
  const month = MONTH_KEYS.indexOf(monthName.slice(0, 3).toLowerCase());
  const day = Number(dayText);
  const year = Number(yearText);
  if (month < 0 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** The sentence around a position, for storing the source's own words verbatim. */
function sentenceAround(text: string, at: number): string {
  const before = text.lastIndexOf(".", at);
  const after = text.indexOf(".", at);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? text.length : after + 1;
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
/**
 * Flattens a page's body region into plain text while MARKING its headings, so a
 * window can be attributed to the role heading the agency published above it
 * without ever being attributed to a sibling block's date.
 */
function flattenWithHeadings(html: string): string {
  const marked = html
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner: string) => `${H2_OPEN}${inner}${H2_CLOSE}`)
    // Only an h3 that opens a LIST names an applicant role (see ROLE_OPEN).
    .replace(
      /<h3[^>]*>([\s\S]*?)<\/h3>\s*(?=<ul)/gi,
      (_m, inner: string) => `${ROLE_OPEN}${inner}${ROLE_CLOSE}`,
    );
  return stripTags(marked);
}
/** The verbatim date phrase a day was read from: "October 28, 2026". */
function dayText(monthName: string, dayText: string, yearText: string): string {
  return `${monthName} ${dayText}, ${yearText}`;
}
/** The nearest preceding heading of a kind, in whose block the position sits. */
function headingBefore(text: string, at: number, open: string, close: string): string | null {
  const from = text.lastIndexOf(open, at);
  if (from === -1) return null;
  const to = text.indexOf(close, from);
  if (to === -1 || to > at) return null;
  const value = text.slice(from + 1, to).replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : null;
}
/** The label the agency published after a `|`, cut at the end of its own words. */
function pipeLabel(raw: string): string {
  let label = unmark(raw);
  for (const stop of [" The ", " Applicants", " Grant recipients", ". "]) {
    const at = label.indexOf(stop);
    if (at > 0) label = label.slice(0, at).trim();
  }
  return label.slice(0, 80).trim();
}
/**
 * Reads ONE programme page's own windows, closing statement and refused dates.
 * Positions are computed over the page's OWN body region only.
 */
export function iowaWindows(pageHtml: string): IowaPageWindows {
  const text = flattenWithHeadings(pageHtml);
  const windows: IowaWindow[] = [];
  const refused: string[] = [];
  /** True when a position is inside a refused phrase's neighbourhood. */
  const refusedNear = (at: number): boolean =>
    REFUSED_PHRASES.some((phrase) => {
      const found = text.lastIndexOf(phrase, at);
      return found !== -1 && at - found <= 90;
    });
  // The agency's Application Process headings, in document order — a role is
  // read only when the agency enumerates TWO OR MORE applicant blocks there.
  const roleHeadingCount = [...text.matchAll(new RegExp(ROLE_OPEN, "g"))].filter((m) => {
    const at = m.index ?? 0;
    return headingBefore(text, at, H2_OPEN, H2_CLOSE) === ROLE_SECTION;
  }).length;
  const enumeratedRoles = roleHeadingCount >= 2;
  const roleAt = (at: number): string | null => {
    // Only where the agency ENUMERATES its applicant blocks does a block heading
    // name a role; a lone sub-heading under Application Process is a topic.
    if (!enumeratedRoles) return null;
    const section = headingBefore(text, at, H2_OPEN, H2_CLOSE);
    if (section === null || section !== ROLE_SECTION) return null;
    const role = headingBefore(text, at, ROLE_OPEN, ROLE_CLOSE);
    return role === null ? null : unmark(role);
  };
  // 1. `<date> | <label>` — the Timeline lists. Read only a label that names an
  //    applicant DEADLINE; a milestone or funding-period label is refused here.
  for (const match of text.matchAll(PIPE_RE)) {
    const at = match.index ?? 0;
    const dateText = match[1] ?? "";
    const label = pipeLabel(match[5] ?? "");
    const iso = isoDay(match[2] ?? "", match[3] ?? "", match[4] ?? "");
    if (iso === null) continue;
    if (ACCEPT_LABEL_RE.test(label) && !REFUSED_LABEL_RE.test(label) && !refusedNear(at)) {
      windows.push({
        role: roleAt(at),
        label,
        closingText: dateText,
        closeDate: iso,
        openDate: null,
        openText: null,
        rolling: false,
        rollingSentence: null,
      });
    } else if (label.length > 0) {
      refused.push(`${label}: ${dateText}`);
    }
  }
  // 2. `Deadline: <date>` — the role-scoped Application Process blocks.
  for (const match of text.matchAll(COLON_DEADLINE_RE)) {
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 60), at);
    const verbatim = dayText(match[1] ?? "", match[2] ?? "", match[3] ?? "");
    if (REFUSED_MODIFIER_RE.test(before) || refusedNear(at)) {
      const label = unmark(before.split(/[.;|]/).pop() ?? "") || "Deadline";
      refused.push(`${label}: ${verbatim}`);
      continue;
    }
    const iso = isoDay(match[1] ?? "", match[2] ?? "", match[3] ?? "");
    if (iso === null) continue;
    windows.push({
      role: roleAt(at),
      label: "Deadline",
      closingText: verbatim,
      closeDate: iso,
      openDate: null,
      openText: null,
      rolling: false,
      rollingSentence: null,
    });
  }
  // 3. The agency's own prose sentence.
  for (const match of text.matchAll(PROSE_DEADLINE_RE)) {
    const at = match.index ?? 0;
    const iso = isoDay(match[1] ?? "", match[2] ?? "", match[3] ?? "");
    if (iso === null || refusedNear(at)) continue;
    windows.push({
      role: roleAt(at),
      label: "Application deadline",
      closingText: dayText(match[1] ?? "", match[2] ?? "", match[3] ?? ""),
      closeDate: iso,
      openDate: null,
      openText: null,
      rolling: false,
      rollingSentence: null,
    });
  }
  // 4. A published acceptance window.
  for (const match of text.matchAll(ACCEPT_WINDOW_RE)) {
    const at = match.index ?? 0;
    const open = isoDay(match[1] ?? "", match[2] ?? "", match[3] ?? "");
    const close = isoDay(match[4] ?? "", match[5] ?? "", match[6] ?? "");
    if (open === null || close === null) continue;
    windows.push({
      role: roleAt(at),
      label: "Applications accepted from / through",
      closingText: dayText(match[4] ?? "", match[5] ?? "", match[6] ?? ""),
      closeDate: close,
      openDate: open,
      openText: dayText(match[1] ?? "", match[2] ?? "", match[3] ?? ""),
      rolling: false,
      rollingSentence: null,
    });
  }
  // 5. The source's own rolling declaration. `rolling` carries NO close date: the
  //    named day is the end of an open acceptance, not a deadline to expire.
  for (const match of text.matchAll(ROLLING_RE)) {
    const at = match.index ?? 0;
    const sentence = unmark(sentenceAround(text, at));
    windows.push({
      role: roleAt(at),
      label: "Rolling basis",
      closingText: dayText(match[1] ?? "", match[2] ?? "", match[3] ?? ""),
      closeDate: null,
      openDate: null,
      openText: null,
      rolling: true,
      rollingSentence: sentence,
    });
  }
  if (windows.length === 0 && ROLLING_BARE_RE.test(text)) {
    const at = text.search(ROLLING_BARE_RE);
    windows.push({
      role: roleAt(at),
      label: "Rolling basis",
      closingText: "",
      closeDate: null,
      openDate: null,
      openText: null,
      rolling: true,
      rollingSentence: unmark(sentenceAround(text, at)),
    });
  }
  // Refused dates this source publishes next to a real window, kept verbatim so
  // a reviewer can re-derive the decision (never promoted to a close date).
  for (const phrase of REFUSED_PHRASES) {
    let from = text.indexOf(phrase);
    while (from !== -1) {
      const tail = text.slice(from + phrase.length, from + phrase.length + 90);
      const day = new RegExp(DAY_SOURCE, "i").exec(tail);
      if (day) refused.push(`${phrase} → ${dayText(day[1] ?? "", day[2] ?? "", day[3] ?? "")}`);
      from = text.indexOf(phrase, from + phrase.length);
    }
  }
  const closedAt = text.search(NOT_ACCEPTING_RE);
  return {
    windows,
    closedSentence: closedAt === -1 ? null : unmark(sentenceAround(text, closedAt)),
    refused: [...new Set(refused.map((r) => unmark(r)))].filter((r) => r.length > 0),
  };
}
/** The page's own h1 — the agency's title for the programme. */
function pageTitle(html: string): string | null {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return null;
  const title = stripTags(match[1] ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}
/** The body region of one page: its own content field, never the site furniture. */
function pageBody(html: string): string {
  const start = html.indexOf(IOWA_CHILD_MARKER);
  if (start === -1) return html;
  const rest = html.slice(start);
  for (const end of ["field--name-field-basic-page__contacts", "field--name-field-basic-page__related"]) {
    const at = rest.indexOf(end);
    if (at !== -1) return rest.slice(0, at);
  }
  return rest;
}
/**
 * Parses the fetched corpus into normalised, unclassified records. One record per
 * labelled application window; one for a programme the agency itself says is
 * closed; one (dated or not) for a programme whose page publishes no window.
 */
export function parseIowaPages(raw: string): SourceGrantRecord[] {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateSourceError("parse", "Iowa payload is empty");
  }
  if (!raw.includes(IOWA_INDEX_MARKER) && !raw.includes(IOWA_CHILD_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Iowa payload does not come from ${IOWA_SOURCE_NAME}: it names neither the listing's ` +
        `"${IOWA_INDEX_MARKER}" block nor a programme page's "${IOWA_CHILD_MARKER}" body — refusing to parse it`,
    );
  }
  const records: SourceGrantRecord[] = [];
  const nextId = uniqueExternalIdFactory();
  for (const page of splitSourcePages(raw)) {
    // The listing itself never contributes a record or a date.
    if (page.url.length === 0 || page.url === IOWA_SOURCE_URL) continue;
    if (!IOWA_CHILD_PAGES.includes(page.url)) continue;
    const title = pageTitle(page.html);
    if (title === null) continue;
    const body = pageBody(page.html);
    const { windows, closedSentence, refused } = iowaWindows(body);
    const slug = externalIdFromPath(page.url, [...IOWA_ID_PREFIXES]) ?? "programme";
    const base = {
      sourceKey: IOWA_CONNECTOR_ID,
      stateCode: "IA" as const,
      agency: IOWA_AGENCY,
      summary: NOT_SPECIFIED,
      url: page.url,
      sourceUrl: IOWA_SOURCE_URL,
      estimatedCloseDate: null,
      sourceUpdatedAt: null,
      eligibleApplicants: NOT_SPECIFIED,
      eligibleGeography: NOT_SPECIFIED,
      categories: [],
      awardRange: NOT_SPECIFIED,
      awardMinAmount: null,
      awardMaxAmount: null,
      totalFunding: NOT_SPECIFIED,
      matchingRequirement: NOT_SPECIFIED,
    };
    /** One record for one published window (a role-scoped window is its own row). */
    const push = (window: IowaWindow | null, closed: boolean): void => {
      const role = window?.role ?? null;
      const roleSlug = role === null ? "" : `-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      records.push({
        ...base,
        externalId: nextId(`${IOWA_CONNECTOR_ID}-${slug}${roleSlug}`),
        title: role === null ? title : `${title} — ${role}`,
        postedDate: window?.openDate ?? null,
        closeDate: window?.closeDate ?? null,
        ongoing: window?.rolling === true,
        sourceClosed: closed,
        raw: {
          programmePageUrl: page.url,
          listedBy: IOWA_SOURCE_URL,
          // The agency's own h1 for the programme, verbatim.
          programmeTitle: title,
          // The agency's own role heading, when the window sits under one.
          applicantRole: role,
          windowLabel: window?.label ?? null,
          // The agency's own date phrase for the close, verbatim.
          closingText: window?.closingText ?? null,
          applicationDeadline: window?.closingText ?? null,
          deadlineValue: window?.closingText ?? null,
          openDateText: window?.openText ?? null,
          rollingDeclaredBySource: window?.rolling === true,
          rollingSentence: window?.rollingSentence ?? null,
          sourceClosedDeclaredBySource: closed,
          closedSentence: closed ? closedSentence : null,
          // Labels whose dates exist on this page and were refused, verbatim.
          refusedDates: refused,
          refusedDatesNeverCloseDates: true,
          // Every fact above came from THIS programme's own body region.
          readOnlyFromThisProgrammesOwnPage: true,
          // The listing publishes no window of its own; nothing on it is read.
          indexDatesNeverRead: true,
        },
      });
    };
    const rolling = windows.find((w) => w.rolling);
    const dated = windows.filter((w) => !w.rolling && w.closeDate !== null);
    // Deduplicate within a page: the Scholarship page states the same April 1,
    // 2026 deadline twice (its Timeline label and the prose sentence below it).
    const seen = new Set<string>();
    const uniqueDated = dated.filter((w) => {
      const key = `${w.role ?? ""}|${w.closeDate ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (rolling) push(rolling, closedSentence !== null);
    else if (uniqueDated.length > 0) for (const window of uniqueDated) push(window, closedSentence !== null);
    else push(null, closedSentence !== null);
  }
  return records;
}
/** The Iowa Arts Council programme connector. */
export const iowaConnector: StateGrantConnector<string> = {
  id: IOWA_CONNECTOR_ID,
  stateCode: "IA",
  stateName: "Iowa",
  sourceName: IOWA_SOURCE_NAME,
  agency: IOWA_AGENCY,
  // The FINAL host of the off-host 301, hard-coded (see the header).
  sourceUrl: IOWA_SOURCE_URL,
  officialHost: IOWA_SOURCE_HOST,
  sourceValidationTest: IOWA_SOURCE_VALIDATION_TEST,
  async fetch(): Promise<string> {
    // The listing (its own view block as the marker) plus every pinned programme
    // page (its own body region as the marker). Any failure — including one
    // pinned page — throws, and the run writes nothing.
    return fetchStateGrantPages({
      indexUrl: IOWA_SOURCE_URL,
      marker: IOWA_INDEX_MARKER,
      label: "Iowa Arts Council grants & programs",
      approvedHosts: IOWA_APPROVED_HOSTS,
      minBytes: 10_000,
      childMinBytes: 4_000,
      childMarker: IOWA_CHILD_MARKER,
      maxChildren: IOWA_MAX_CHILD_PAGES,
      // PINNED, not link-derived: the catalogue's tiles duplicate the pages and
      // include a grantee support FAQ.
      childUrls: () => [...IOWA_CHILD_PAGES],
    });
  },
  parse(raw: string): SourceGrantRecord[] {
    return parseIowaPages(raw);
  },
  classify(record: SourceGrantRecord, now?: Date | number): GrantClassification {
    return classifyStateGrant(record, now);
  },
};
