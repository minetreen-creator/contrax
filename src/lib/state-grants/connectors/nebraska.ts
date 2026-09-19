/**
 * NEBRASKA CONNECTOR — state grants NATIONWIDE workstream, PR #408 (owner
 * correction 2026-09-19, ratified 243: ONE continuous workstream).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://opportunity.nebraska.gov/programs/ — the Nebraska Department of
 *   Economic Development's own "Dept. of Economic Development Programs" index,
 *   plus the DED programme pages that index publishes. Plain HTML (WordPress +
 *   the Divi builder): no key, no login, no JavaScript required.
 *
 * WHY THIS IS A MULTI-PAGE SOURCE. The index is a PROGRAM CATALOGUE: it names 63
 * programmes and publishes **ZERO date tokens of its own** (verified 2026-09-19),
 * so every date on it belongs to site furniture (news, "Stay up to date"), never
 * to an application window. It is therefore read for ONE reason only — it is the
 * agency's own list of programme pages — and every record is read from the
 * programme page's OWN window block. No record can inherit a date, a status or a
 * sentence from a sibling programme or from the index (the District of Columbia
 * NO-GO cause was exactly a date inherited from the wrong block).
 *
 * WHERE A WINDOW LIVES ON A PROGRAMME PAGE (the structural contract). Each
 * opportunity is one Divi promo module:
 *   <div class="et_pb_promo_description">
 *     <h2 class="et_pb_module_header">SBIR/STTR Phase 0</h2>
 *     <div class="et_pb_promo_content">…window labels…</div>
 *   </div>
 *     …<a class="et_pb_promo_button" href="https://ne.amplifund.com/…">Apply Now</a>
 * so this connector reads the module's own `h2` (the SOURCE's title, used
 * verbatim — no reconstruction from surrounding prose, and nothing to strip) and
 * the module's own content. The `ne.amplifund.com` link is the DED's application
 * portal behind that button; it is never a record URL (every record points at the
 * DED page that publishes the window) and its UUIDs are deliberately NOT used for
 * identity, so a re-parse is stable even if the portal is re-issued.
 *
 * THE SOURCE'S OWN WINDOW GRAMMAR (each variant is on a live page and pinned by a
 * fixture): `Application Period: Open Date: 7/7/2026 … Close Date: 6/30/2027 …`
 * (colon form), `Open Date - 2/20/2025 … Close Date - 5/22/2025 …` (dash form),
 * `Submission Open Date: … Submission Close Date: …`, `Pre-Application Period
 * Opens: … Closes: …` + `Full Application Opens/Closes: …`, bare `Open Date: …
 * Close Date: …` with no "Application Period" prefix, `Application Period: July
 * 1, 2026 to June 30, 2027` (date-to-date range, en-dash or "to"), and the
 * source's own open-ended wording `Application Period: Open Cycle` /
 * `Application Deadlines: Open Cycle` / `Applications will be reviewed and funded
 * on an open cycle` ⇒ `rolling`.
 *
 * WHAT IS REFUSED (never a close date, never a status):
 *   - `Anticipated Award Date`, `Letter of Intent Deadline`, `Period of
 *     Performance`, `Contract Term`, `Award Amount`;
 *   - every press-release/announcement date — those live in TOGGLE/news modules
 *     ("Review current and archived news", "Archived Pre-Award Program
 *     Announcements", "Applications open Friday, October 31, 2022"), which carry
 *     no promo-module h2 and so are never read. The refusal is structural, not a
 *     keyword filter: a date has to sit under an application-window LABEL inside
 *     the module to be read at all, and the labels this connector accepts are
 *     `Open Date`/`Close Date`/`Submission Open|Close Date`/`(Pre-|Full
 *     )Application (Period )?Opens|Closes`/`Application Deadline(s)`/
 *     `Applications Due`. A bare `Deadline`, `Period of Performance` or
 *     `Anticipated Award Date` matches none of them;
 *   - a page's boilerplate `January 1, 2022` (site furniture, and outside every
 *     promo module anyway);
 *   - a YEAR-LESS deadline (`Application Deadline: Sept. 15` on the CDBG page):
 *     the value is kept verbatim in `raw`, `parseStateDay` refuses an invented
 *     year, and the record stays `unverified` with NO close date;
 *   - a module that publishes SEVERAL periods at once (`Application Periods: Jan.
 *     3, 2022 – June 30, 2023 … Sept. 3, 2025 – Dec. 31, 2025`, the Nebraska
 *     Rural Projects Act): more than two published days in one window block is a
 *     multi-period block we cannot resolve to one cycle, so NO date is taken and
 *     the record stays `unverified` with both periods verbatim in `raw`;
 *   - a module whose dates do not sit under an accepted label (`t/…` is the only
 *     way a date becomes a record's `postedDate`/`closeDate`).
 *
 * A PAST CYCLE IS `closed`, NOT HIDDEN. The DED keeps last year's cycles on the
 * live page (2022–2025 award rounds across the recovery programmes); each one is a
 * real published cycle whose closing date has passed, so it is served `closed`,
 * never dropped and never shown as open. A programme whose page says in the
 * source's own words that it is not taking applications (`All available funds have
 * been awarded.`, `is not approving applications submitted in calendar years
 * 2026-2029`) is `closed` by the source's own statement, with no deadline invented.
 *
 * NARROW BY CONSTRUCTION. This is ONE agency's (Nebraska DED) programme pages: 46
 * of the 63 programme pages the index links publish a labelled application-window
 * block as of 2026-09-19 and are pinned below; the remaining pages publish no
 * window block (their dates are Treasury nominations, statutory dates, awardee
 * lists and news) and contribute no record — they are NOT covered. Two of the 63
 * index links (`accredited-job-training-act`, `customized-job-training`) return
 * HTTP 404, which is why the child list is PINNED rather than link-derived: a
 * link-derived sweep would fetch them and `fetchStateGrantPages` would (correctly)
 * fail the whole run. Nebraska awards other grants through other agencies and
 * local bodies we have NOT validated, so the state is `limited` — never
 * `curated`/`connected` — and this is not statewide coverage.
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
  declaresOngoing,
  publishedDaysIn,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import {
  fetchStateGrantPages,
  splitSourcePages,
} from "~/lib/state-grants/connectors/multi-page";
/** The DED's own programme index — the listing this connector reads first. */
export const NEBRASKA_SOURCE_URL = "https://opportunity.nebraska.gov/programs/";
export const NEBRASKA_SOURCE_HOST = "opportunity.nebraska.gov";
export const NEBRASKA_APPROVED_HOSTS: readonly string[] = [
  "opportunity.nebraska.gov",
  "www.opportunity.nebraska.gov",
];
/** The publishing body, in the page's own words (asserted against live text). */
export const NEBRASKA_AGENCY = "Nebraska Department of Economic Development";
export const NEBRASKA_SOURCE_NAME = `${NEBRASKA_AGENCY} — Programs`;
export const NEBRASKA_CONNECTOR_ID = "ne-ded-programs";
export const NEBRASKA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/nebraska.source-validation.test.ts";
/** The index's own h1 (its own name for itself) — the index fetch's marker. */
export const NEBRASKA_INDEX_MARKER = "Dept. of Economic Development Programs";
/**
 * The body every page of this source names itself by; the marker each CHILD fetch
 * must carry, so a child that stops being a DED programme page fails the run.
 * (It is present on the theme's 404 page too, which is why the index marker above
 * is the h1 and the child list is pinned rather than link-derived.)
 */
export const NEBRASKA_CHILD_MARKER = NEBRASKA_AGENCY;
/**
 * The DED keeps this many programme pages with a labelled application-window
 * block (2026-09-19: 46 of the 63 the index links). A page list larger than this
 * fails the run loudly rather than silently parsing a truncated catalogue.
 */
export const NEBRASKA_MAX_CHILD_PAGES = 46;
/**
 * The pinned child pages, in the INDEX's own document order (verified
 * 2026-09-19). Pinned, not link-derived: two index links 404, and the index also
 * links pages that publish no application window (see the header).
 */
export const NEBRASKA_PROGRAMME_PATHS: readonly string[] = [
  "business/microenterprise-assistance-program/",
  "business/municipal-inland-port-authority/",
  "business/nebraska-academic-research-and-development-grant/",
  "business/nif-prototype-grants/",
  "business/read-nebraska/",
  "business/sbdf/",
  "business/sbir-sttr/",
  "business/shovel-ready-grants/",
  "business/ssbci/",
  "business/step/",
  "community/cccff/",
  "community/cdaa/",
  "community/cdbg/",
  "community/rural-projects/",
  "housing/home-arp/",
  "housing/home/",
  "housing/htf/",
  "housing/mwhf/",
  "housing/nahtf/",
  "housing/rcrp/",
  "housing/rwhf/",
  "incentives/ccna/",
  "incentives/film-office-grant/",
  "incentives/panhandle-improvement-project-cash-fund/",
  "incentives/renewable-chemical-production/",
  "incentives/yoeif/",
  "recovery/airport-business-park/",
  "recovery/chief-standing-bear-program/",
  "recovery/county-agricultural-society-grant-program/",
  "recovery/eda-tourism/",
  "recovery/fqhc/",
  "recovery/good-life-transformational-projects-act/",
  "recovery/hall-of-fame-museum-grant-program/",
  "recovery/ihubs/",
  "recovery/international-competition-sponsorship/",
  "recovery/internships-and-crime-prevention/",
  "recovery/meat-processing-wastewater/",
  "recovery/mental-health-capacity-program/",
  "recovery/multi-purpose-community-facilities/",
  "recovery/nuclear-plant-siting-feasibility-study-program/",
  "recovery/pandemic-relief-housing-program/",
  "recovery/qct-affordable-housing-program/",
  "recovery/qct-recovery-grant-program/",
  "recovery/rdi/",
  "recovery/refugee-job-training-and-placement/",
  "recovery/rural-workforce-housing-land-development-program/",
];
/** The pinned pages as absolute URLs (what the connector actually fetches). */
export const NEBRASKA_CHILD_PAGES: readonly string[] = NEBRASKA_PROGRAMME_PATHS.map(
  (path) => `${NEBRASKA_SOURCE_URL}${path}`,
);
// ── The promo module: the ONE place a window may live ────────────────────────
const PROMO_MODULE_OPEN = '<div class="et_pb_promo_description">';
const MODULE_TITLE_RE = /<h2 class="et_pb_module_header">([\s\S]*?)<\/h2>/i;
const MODULE_CONTENT_RE = /<div class="et_pb_promo_content">/i;
/** The module's own Apply button, which always FOLLOWS the module's content. */
const MODULE_BUTTON_RE = '<div class="et_pb_button_wrapper">';
/**
 * How much of a module's content may be read at most. The content is normally
 * bounded by the module's own Apply button; this cap only stops a module that has
 * NO button from dragging a page's later prose into its window (the CCCFF "Review
 * current and archived news." card is exactly that shape, and reading past its
 * own text was how an "Anticipated Award Date" once looked like a window).
 */
const MODULE_CONTENT_CAP = 6000;
/**
 * Invisible directional/zero-width marks. The DED's own Film Office page
 * publishes its closing date as `6\u200E/8\u200E/2025` — the U+200E marks sit
 * INSIDE the value, so `parseStateDay` cannot read it until they are removed.
 * Only these invisible formatting characters are removed; no visible character is
 * touched, and the source's own words are otherwise kept verbatim.
 */
const INVISIBLE_MARKS_RE = /[\u200b\u200c\u200d\u200e\u200f\u2060\ufeff\u00ad]/g;
/**
 * The source's own labels for the START of an application window. Split in two:
 * a NOUN label (`Open Date`) names a date and the source sometimes writes it with
 * no separator at all (`Open Date 7/10/2026 8:00 AM CT`), while a PHRASE label
 * (`Application Opens`) must be followed by `:` or `-` before a date counts —
 * because the DED's own news copy writes press-release sentences such as
 * "Application Opens Friday, September 30, 2022", and an announcement date is
 * never a window (the recon's refusal rule, enforced structurally).
 */
const OPEN_NOUN_LABEL_SOURCE =
  "(?:submission open date|application open date|open date)";
const OPEN_PHRASE_LABEL_SOURCE =
  "(?:pre-application period opens|pre-application opens|full application period opens|" +
  "full application opens|application period opens|applications open|application opens|application open)";
const OPEN_LABEL_SOURCE = `(?:${OPEN_NOUN_LABEL_SOURCE}|${OPEN_PHRASE_LABEL_SOURCE})`;
/** The source's own labels for the END of an application window (see above). */
const CLOSE_NOUN_LABEL_SOURCE =
  "(?:submission close date|application close date|due date|close date)";
const CLOSE_PHRASE_LABEL_SOURCE =
  "(?:pre-application period closes|full application period closes|full application closes|" +
  "application period closes|applications close|application closes|application deadlines?|" +
  "applications due|application due)";
const CLOSE_LABEL_SOURCE = `(?:${CLOSE_NOUN_LABEL_SOURCE}|${CLOSE_PHRASE_LABEL_SOURCE})`;
/** A label plus the separator the source writes after it (`:` or `-`, or none). */
const LABEL_TAIL = "\\s*[:\\-\u2013]?\\s*";
/** The head of a window value that is a date-to-date RANGE. */
const RANGE_HEAD_SOURCE =
  "(?:application periods?|application dates?|application window|submission period)";
/** All three at once: does this block say ANYTHING about an application window? */
const WINDOW_HEAD_RE = new RegExp(
  `(?:${OPEN_LABEL_SOURCE}|${CLOSE_LABEL_SOURCE}|${RANGE_HEAD_SOURCE})`,
  "i",
);
/** A month-and-day with NO year ("Sept. 15") — a deadline we may not date. */
const YEARLESS_DAY_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b(?!\s*,?\s*\d{4})/i;
/** A date-to-date range separator, in the source's own wording. */
const RANGE_SEPARATOR_RE = /\s(?:to|through|until|-|\u2013)\s/i;
/**
 * The source's own words for "this programme is not taking applications". Read
 * only inside a promo module, and only as a closure — never as a deadline.
 */
const CLOSED_WORDS_RE =
  /\b(?:not (?:currently )?(?:accepting|approving) applications|no longer accepting applications|all (?:available )?funds have been (?:awarded|exhausted)|funds have been (?:fully )?(?:awarded|exhausted)|applications (?:are|is) (?:now )?closed)\b/i;
/** Labels whose dates this connector REFUSES, in the source's own wording. */
const REFUSED_LABEL_RE =
  /\b(?:anticipated award date|letter of intent deadline|period of performance|contract term|award amount)\b/gi;
/** One promo module: the source's own title + the source's own window text. */
export interface NebraskaWindowModule {
  /** The page's URL (the pinned child page this module was read from). */
  url: string;
  /** The module's `h2` — the DED's own title for this opportunity. */
  title: string;
  /**
   * The module's window text, tags stripped, invisible marks removed, with the
   * source's own block boundaries kept as the private `BLOCK_BREAK` marker (a
   * label's value ends at one).
   */
  text: string;
  /** The same text as a reader sees it: block boundaries are single spaces. */
  windowText: string;
}
/**
 * Every promo module on a page that carries its own `h2` title. A promo module
 * WITHOUT an `h2` is skipped: the DED's own title for an opportunity is the only
 * title this connector will publish (a module with no title is either site
 * furniture or a card whose heading lives elsewhere, and guessing a title from
 * surrounding prose is what the recon's "text before the label" rule had to do
 * and what the `h2` makes unnecessary).
 */
export function nebraskaWindowModules(html: string, pageUrl: string): NebraskaWindowModule[] {
  const out: NebraskaWindowModule[] = [];
  const starts: number[] = [];
  for (let at = html.indexOf(PROMO_MODULE_OPEN); at !== -1; at = html.indexOf(PROMO_MODULE_OPEN, at + 1)) {
    starts.push(at);
  }
  for (let i = 0; i < starts.length; i++) {
    const segment = html.slice(starts[i]!, i + 1 < starts.length ? starts[i + 1]! : html.length);
    const titleTag = MODULE_TITLE_RE.exec(segment);
    if (!titleTag) continue;
    const contentAt = MODULE_CONTENT_RE.exec(segment);
    const title = cleanModuleText(stripTags(titleTag[1] ?? ""));
    const contentHtml = moduleContent(segment, contentAt).replace(BLOCK_END_RE, BLOCK_BREAK);
    const text = cleanModuleText(stripTags(contentHtml));
    if (title.length === 0) continue;
    out.push({ url: pageUrl, title, text, windowText: blockBreaksToSpaces(text) });
  }
  return out;
}
/**
 * A private marker standing for the end of one block element (`</p>`, `</div>`,
 * `</li>`, `</td>`, `</h2>`…) inside a module's content.
 *
 * WHY IT IS NEEDED (found live on `recovery/internships-and-crime-prevention`,
 * 2026-09-19): a module with no Apply button runs on into the card's NEXT column,
 * where the DED prints `Letter of Intent: October 31, 2022`, `Anticipated Award
 * Date: November 2022` and `Period of Performance: …`. Reading a label's value to
 * a fixed character count therefore swallowed a SECOND date from a REFUSED label,
 * `singlePublishedDay` correctly refused the ambiguous value, and a real
 * `Close Date - 11/14/2022` was dropped. The source's own block boundaries are the
 * honest end of a value, so the module text keeps them.
 */
const BLOCK_BREAK = "\u0000";
/** Block-level elements only: a label and its value are never split by these. */
const BLOCK_END_RE = /<\/(?:p|div|li|td|th|tr|ul|ol|table|h[1-6])\s*>/gi;
/** A module's own content: from its `et_pb_promo_content` to the module's OWN
 * Apply button (which closes the module), capped. Never past the next module. */
function moduleContent(segment: string, contentAt: RegExpExecArray | null): string {
  if (contentAt === null) return segment;
  const from = (contentAt.index ?? 0) + contentAt[0].length;
  const button = segment.indexOf(MODULE_BUTTON_RE, from);
  const stop =
    button === -1
      ? Math.min(from + MODULE_CONTENT_CAP, segment.length)
      : Math.min(button, from + MODULE_CONTENT_CAP);
  return segment.slice(from, stop);
}
/** Tags stripped, invisible formatting marks removed, whitespace collapsed. */
function cleanModuleText(text: string): string {
  return text.replace(INVISIBLE_MARKS_RE, "").replace(/\s+/g, " ").trim();
}
/** The reader-facing form of a module's text: block boundaries are spaces. */
function blockBreaksToSpaces(text: string): string {
  return text.replace(new RegExp(BLOCK_BREAK, "g"), " ").replace(/\s+/g, " ").trim();
}
/**
 * The end of a labelled value: the next label, the source's own next block, or a
 * hard cap — whichever comes first. A value never runs into another block, so a
 * REFUSED label's date can never become part of this one.
 */
function valueStop(text: string, end: number, nextStart: number, cap = 90): number {
  const blockEnd = text.indexOf(BLOCK_BREAK, end);
  return Math.min(nextStart, end + cap, blockEnd === -1 ? text.length : blockEnd, text.length);
}
/** One application window read off ONE promo module. */
export interface NebraskaWindow {
  /** The source's opening date, or null when it published none. */
  openDate: string | null;
  /** The source's closing date, or null when it published none. */
  closeDate: string | null;
  /** The label the opening date was read under, verbatim. */
  openLabel: string | null;
  /** The label the closing date was read under, verbatim. */
  closeLabel: string | null;
  /** The source's own value text for the opening/closing date. */
  openValue: string | null;
  closeValue: string | null;
  /** True when the module publishes more days than one window can resolve. */
  multiPeriod: boolean;
  /** True when the module's own words declare an open cycle / ongoing intake. */
  rolling: boolean;
  /** The source's own rolling sentence, verbatim. */
  rollingSentence: string | null;
  /** True when the module's own words say the programme is not taking applications. */
  closed: boolean;
  /** The source's own closure sentence, verbatim. */
  closedSentence: string | null;
  /** A date the source published under a REFUSED label, kept for a reviewer. */
  refusedLabels: string[];
}
/** One labelled-window hit in a module's text. */
interface NebraskaLabelHit {
  start: number;
  end: number;
  kind: "open" | "close";
  label: string;
  /** True for a NOUN label ("Open Date"), false for a PHRASE label ("Application Opens"). */
  nounForm: boolean;
  /** True when the source wrote `:` or `-` straight after the label. */
  hasSeparator: boolean;
}
/** All labelled-window hits in a module's text, in source order. */
function labelHits(text: string): NebraskaLabelHit[] {
  const re = new RegExp(
    `(${OPEN_NOUN_LABEL_SOURCE})|(${OPEN_PHRASE_LABEL_SOURCE})|(${CLOSE_NOUN_LABEL_SOURCE})|(${CLOSE_PHRASE_LABEL_SOURCE})`,
    "gi",
  );
  const hits: NebraskaLabelHit[] = [];
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    hits.push({
      start: at,
      end,
      kind: m[1] !== undefined || m[2] !== undefined ? "open" : "close",
      label: m[0].trim().replace(/[:\-\u2013]+$/, "").trim(),
      nounForm: m[1] !== undefined || m[3] !== undefined,
      hasSeparator: /^\s*[:\-\u2013]/.test(text.slice(end, end + 4)),
    });
  }
  return hits;
}
/** The label's own value: from the label's end to the next label (≤90 chars). */
function labelValue(text: string, end: number, nextStart: number): string {
  const stop = valueStop(text, end, nextStart);
  return blockBreaksToSpaces(text.slice(end, stop)).replace(new RegExp(`^${LABEL_TAIL}`), "").trim();
}
/**
 * Reads the application window a single promo module publishes.
 *
 * HONESTY (CONVENTIONS.md §1–§2, never loosened here):
 *   - `parseStateDay` decides every date; a value that does not parse EXACTLY is
 *     null (a year-less `Sept. 15`, a `6/29/21` two-digit year, prose);
 *   - a block publishing MORE than two days is a multi-period block: no date is
 *     taken at all (never a pick, never an average);
 *   - a range is read in the source's own order (start → end) only when the two
 *     ends are separated by the source's own range wording and there are exactly
 *     two of them;
 *   - `rolling` requires the source's own open-ended wording (an "open cycle", or
 *     the shared rolling vocabulary) AND no published date;
 *   - `closed` requires the source's own negative wording; it never comes from a
 *     date we read.
 */
export function nebraskaWindow(text: string): NebraskaWindow {
  const days = publishedDaysIn(text);
  const rollingSentence = rollingDeclaredSentence(text);
  const closedSentence = closedWordSentence(text);
  const refusedLabels = [...text.matchAll(new RegExp(REFUSED_LABEL_RE.source, "gi"))].map((m) =>
    (m[0] ?? "").trim(),
  );
  const base: NebraskaWindow = {
    openDate: null,
    closeDate: null,
    openLabel: null,
    closeLabel: null,
    openValue: null,
    closeValue: null,
    multiPeriod: false,
    rolling: false,
    rollingSentence,
    closed: closedSentence !== null,
    closedSentence,
    refusedLabels: [...new Set(refusedLabels)],
  };
  const hits = labelHits(text);
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    // A PHRASE label only carries a date when the source wrote the label FORM
    // (`Open Date:`, `Application Opens:`) — a press-release sentence that merely
    // contains the words ("Application Opens Friday, September 30, 2022") is not
    // a labelled window.
    if (!hit.nounForm && !hit.hasSeparator) continue;
    const next = hits[i + 1]?.start ?? text.length;
    const value = labelValue(text, hit.end, next);
    const day = singlePublishedDay(value);
    if (day === null) continue;
    if (hit.kind === "open" && base.openDate === null) {
      base.openDate = day;
      base.openLabel = hit.label;
      base.openValue = value;
    }
    if (hit.kind === "close" && base.closeDate === null) {
      base.closeDate = day;
      base.closeLabel = hit.label;
      base.closeValue = value;
    }
  }
  if (base.openDate === null && base.closeDate === null && !base.closed) {
    // A date-to-date RANGE under the source's own range head ("Application
    // Period: July 1, 2026 to June 30, 2027"). Exactly two ends, in source
    // order, separated by the source's own range wording — nothing is picked.
    const rangeHead = new RegExp(RANGE_HEAD_SOURCE + LABEL_TAIL, "gi");
    for (const m of text.matchAll(rangeHead)) {
      const at = m.index ?? 0;
      const from = at + m[0].length;
      const tail = blockBreaksToSpaces(text.slice(from, valueStop(text, from, text.length)));
      const split = RANGE_SEPARATOR_RE.exec(tail);
      if (split === null) continue;
      const startRaw = tail.slice(0, split.index);
      const endRaw = tail.slice(split.index + split[0].length);
      const start = singlePublishedDay(startRaw);
      const end = singlePublishedDay(endRaw);
      if (start === null || end === null) continue;
      base.openDate = start;
      base.closeDate = end;
      base.openLabel = m[0].trim().replace(/[:\-\u2013]+$/, "").trim();
      base.closeLabel = base.openLabel;
      base.openValue = startRaw.trim();
      base.closeValue = endRaw.trim();
      break;
    }
  }
  if (base.openDate === null && base.closeDate === null && base.rollingSentence !== null) {
    base.rolling = true;
  }
  // A block that publishes MORE days than one window can resolve, and from which
  // no window was read, is a multi-period block: no date was picked from it (the
  // Nebraska Rural Projects Act publishes two successive periods under one
  // plural head). Flagged so a reviewer can see the refusal.
  base.multiPeriod =
    WINDOW_HEAD_RE.test(text) && days.length > 2 && base.openDate === null && base.closeDate === null;
  return base;
}
/** The source's own open-cycle/rolling sentence, or null. */
function rollingDeclaredSentence(text: string): string | null {
  if (!WINDOW_HEAD_RE.test(text)) return null;
  const openCycle = /\bopen cycle\b/i.exec(text);
  if (openCycle !== null) return sentenceAround(text, openCycle.index ?? 0);
  if (!declaresOngoing(text)) return null;
  const m = /\b(?:year[\s-]?round|rolling|ongoing|continuous|open until filled|always open|until (?:all )?funds (?:are|is) (?:awarded|exhausted))\b/i.exec(
    text,
  );
  return m === null ? null : sentenceAround(text, m.index ?? 0);
}
/** The source's own closure sentence, or null. */
function closedWordSentence(text: string): string | null {
  const m = new RegExp(CLOSED_WORDS_RE.source, "i").exec(text);
  return m === null ? null : sentenceAround(text, m.index ?? 0);
}
/** The sentence a match sits in, trimmed — so `raw` carries the source's words. */
function sentenceAround(text: string, at: number): string {
  let start = 0;
  for (let i = at; i > 0; i--) {
    if (/[.!?;]/.test(text[i - 1] ?? "")) {
      start = i;
      break;
    }
  }
  let end = text.length;
  for (let i = at; i < text.length; i++) {
    if (/[.!?;]/.test(text[i] ?? "")) {
      end = i + 1;
      break;
    }
  }
  return text.slice(start, end).trim();
}
/** True when a module publishes a window this connector may turn into a record. */
function modulePublishesWindow(module: NebraskaWindowModule, window: NebraskaWindow): boolean {
  if (!WINDOW_HEAD_RE.test(module.text)) return false;
  if (window.openDate !== null || window.closeDate !== null) return true;
  if (window.rolling || window.closed) return true;
  // A window block that publishes SEVERAL periods at once (the Nebraska Rural
  // Projects Act) is a real published opportunity this connector refuses to date:
  // the record exists, `unverified`, with both periods verbatim in `raw`.
  if (window.multiPeriod) return true;
  // A labelled deadline whose VALUE this connector refuses to date (the year-less
  // `Application Deadline: Sept. 15`): a real published opportunity with no
  // usable date — kept `unverified`, never given an invented year.
  for (const hit of labelHits(module.text)) {
    if (hit.kind !== "close") continue;
    const value = labelValue(module.text, hit.end, module.text.length);
    if (YEARLESS_DAY_RE.test(value)) return true;
  }
  return false;
}
/**
 * Parses a fetched NE payload (the index plus the pinned programme pages,
 * delimited by `joinSourcePages`) into unclassified records. Fail-closed: a
 * payload that is not this source throws a `parse`-stage `StateSourceError`.
 */
export function parseNebraskaPages(raw: string): SourceGrantRecord[] {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateSourceError("parse", "Nebraska payload is empty");
  }
  const pages = splitSourcePages(raw);
  const carriesSource = raw.includes(NEBRASKA_CHILD_MARKER) || raw.includes(NEBRASKA_INDEX_MARKER);
  if (!carriesSource) {
    throw new StateSourceError(
      "parse",
      `Nebraska payload does not come from ${NEBRASKA_SOURCE_NAME}: it names neither ` +
        `"${NEBRASKA_CHILD_MARKER}" nor "${NEBRASKA_INDEX_MARKER}" — refusing to parse it`,
    );
  }
  const records: SourceGrantRecord[] = [];
  const nextId = uniqueExternalIdFactory();
  for (const page of pages) {
    // A payload with no delimiters (a raw single page) is attributed to the
    // listing, so a record never claims a page it cannot name.
    const pageUrl = page.url.length > 0 ? page.url : NEBRASKA_SOURCE_URL;
    for (const module of nebraskaWindowModules(page.html, pageUrl)) {
      const window = nebraskaWindow(module.text);
      if (!modulePublishesWindow(module, window)) continue;
      const slug = slugify(module.title);
      if (slug.length === 0) continue;
      const suffix =
        window.closeDate !== null
          ? `-${window.closeDate}`
          : window.openDate !== null
            ? `-open-${window.openDate}`
            : "";
      records.push({
        sourceKey: NEBRASKA_CONNECTOR_ID,
        stateCode: "NE",
        externalId: nextId(`${NEBRASKA_CONNECTOR_ID}-${slug}${suffix}`),
        title: module.title,
        agency: NEBRASKA_AGENCY,
        summary: NOT_SPECIFIED,
        // The programme page that PUBLISHES this window — never the listing, never
        // a sibling programme, never the application portal behind the button.
        url: pageUrl,
        sourceUrl: NEBRASKA_SOURCE_URL,
        postedDate: window.openDate,
        closeDate: window.closeDate,
        estimatedCloseDate: null,
        ongoing: window.rolling,
        sourceClosed: window.closed,
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
          programmePageUrl: pageUrl,
          listedBy: NEBRASKA_SOURCE_URL,
          // The DED's own title for this window, verbatim from the module's h2.
          moduleTitle: module.title,
          // The module's own window text, verbatim (invisible marks removed).
          windowText: module.text,
          openDateLabel: window.openLabel,
          openDateValue: window.openValue,
          closeDateLabel: window.closeLabel,
          deadlineValue: window.closeValue,
          closingText: window.closeValue,
          // The source's own open-ended wording, or null.
          rollingDeclaredBySource: window.rolling,
          rollingSentence: window.rollingSentence,
          // The source's own closure wording, or null.
          sourceClosedDeclaredBySource: window.closed,
          closedSentence: window.closedSentence,
          // A window block publishing more than two days: no date was taken.
          multiPeriodBlockRefused: window.multiPeriod,
          // Labels whose dates exist on this page and were refused.
          refusedDates: window.refusedLabels,
          refusedDatesNeverCloseDates: true,
          // Every fact above came from THIS programme's own window module.
          readOnlyFromThisProgrammesOwnWindowBlock: true,
          // The index publishes zero date tokens of its own; nothing on it is read.
          indexDatesNeverRead: true,
        },
      });
    }
  }
  return records;
}
/** The DED programme connector. */
export const nebraskaConnector: StateGrantConnector<string> = {
  id: NEBRASKA_CONNECTOR_ID,
  stateCode: "NE",
  stateName: "Nebraska",
  sourceName: NEBRASKA_SOURCE_NAME,
  agency: NEBRASKA_AGENCY,
  sourceUrl: NEBRASKA_SOURCE_URL,
  officialHost: NEBRASKA_SOURCE_HOST,
  sourceValidationTest: NEBRASKA_SOURCE_VALIDATION_TEST,
  async fetch(): Promise<string> {
    // The index (its own h1 as the marker) plus every pinned programme page (the
    // body's own name as the child marker). Any failure — including one pinned
    // page — throws, and the run writes nothing.
    return fetchStateGrantPages({
      indexUrl: NEBRASKA_SOURCE_URL,
      marker: NEBRASKA_INDEX_MARKER,
      label: "Nebraska DED programmes",
      approvedHosts: NEBRASKA_APPROVED_HOSTS,
      minBytes: 10_000,
      childMinBytes: 10_000,
      childMarker: NEBRASKA_CHILD_MARKER,
      maxChildren: NEBRASKA_MAX_CHILD_PAGES,
      // PINNED, not link-derived: the index links two 404s and many pages with no
      // application window.
      childUrls: () => [...NEBRASKA_CHILD_PAGES],
    });
  },
  parse(raw: string): SourceGrantRecord[] {
    return parseNebraskaPages(raw);
  },
  classify(record: SourceGrantRecord, now?: Date | number): GrantClassification {
    return classifyStateGrant(record, now);
  },
};
