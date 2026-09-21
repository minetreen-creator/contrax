/**
 * MARYLAND CONNECTOR — state grants NATIONWIDE workstream, next-12 tranche
 * (owner correction 2026-09-19, ratified 243: ONE continuous workstream, ONE
 * accumulating PR #408; build spec §C, MD).
 *
 * OFFICIAL SOURCE (hard-coded; no client-controllable URL anywhere in this flow):
 *   https://msac.org/programs/grants-organizations   — the Maryland State Arts
 *   Council's own Grants for Organizations (GFO) programme page, on the Council's
 *   own domain (an agency domain rather than a .gov one — the vatc.org /
 *   southcarolinaarts.com precedent). Server-rendered Drupal HTML: no key, no
 *   login, no JavaScript.
 *
 * WHY THIS IS A MULTI-PAGE SOURCE. The GFO index is a PROGRAM CATALOGUE: live, it
 * publishes its programme copy, an FY25 award total, the funding-formula history
 * and ZERO dates (its only date token is "September 9, 2021", the day the Council
 * adopted the formula — a governance date, never a cycle). Parsing it could only
 * ever produce all-`unverified` records, which the build spec's rule A.2 says does
 * NOT earn a tier. Each GFO programme page the INDEX itself publishes is fetched
 * and every record is read from its OWN page (the District of Columbia NO-GO cause
 * was a date inherited from the wrong block, so page attribution is structural).
 *
 * WHY THE CHILD URLS ARE SCOPED TO `/programs/grants-organizations/<slug>`: the
 * index's navigation links a dozen SIBLING programme families of the same Council
 * (Arts Capital, Arts in Education, County Arts Development, Creativity Grants,
 * Grants for Artists, Maryland Traditions, Poetry Out Loud, …). Those are other
 * programmes, not this one, and one of them (Poetry Out Loud) carries a schools
 * COMPETITION deadline — a competition date is not a grant deadline and must never
 * be served to a grant seeker. Only the GFO programme pages are read.
 *
 * THE ONE DATE THE SOURCE LABELS. MSAC publishes each programme page's cycle date
 * in its own "Quick Resources" box as a labelled pair:
 *     <h3 class="aside__section-heading">Deadline</h3>
 *     <div><p>09/15/2026</p></div>
 * The connector reads ONLY a source-labelled `Deadline` block, and the value from
 * that block's OWN window (bounded by the next heading, the next section and the
 * end of the box, so one block can never borrow a sibling's date):
 *   - "Deadline" with NO readable day (e.g. a future page that says "TBD") keeps
 *     the record and leaves the close date EMPTY — `unverified`, never a guess.
 *   - The page's year-less PROSE dates are never deadlines: "must submit an Intent
 *     to Apply form by September 15th annually" and "will then complete a standard
 *     application by November 15" carry no year, so they parse to nothing at all;
 *     they are carried in `raw` for a reviewer and are never promoted.
 *   - The eligibility page's process note ("Grant agreement forms are prepared and
 *     emailed after July 1") and its reporting rule ("by the deadlines specified in
 *     communications from MSAC") are not deadlines either — the second names no
 *     date at all.
 *   - The index's 2021 formula-adoption date and its FY label history are never
 *     read as cycles.
 *   - A PASSED DEADLINE IS `closed` ON A LIVE PAGE. The FY 2028 Intent to Apply
 *     deadline the Council published on 2026-09-19 is 09/15/2026 — four days past
 *     — so the record is served `closed` (owner rule: a published closing date that
 *     has passed is closed, never open), and the connector never "helpfully" moves
 *     on to a later cycle it cannot see.
 *   - NARROW BY CONSTRUCTION. This is ONE programme family (Grants for
 *     Organizations) of ONE agency (the Maryland State Arts Council, under the
 *     Maryland Department of Commerce). Maryland awards other grants through other
 *     agencies we have NOT validated, so the state is `limited` — never
 *     `curated`/`connected`, and the registry note says so.
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
  externalIdFromPath,
  singlePublishedDay,
  stripTags,
  uniqueExternalIdFactory,
} from "~/lib/state-grants/connectors/source-support";
import { fetchStateGrantPages, splitSourcePages } from "~/lib/state-grants/connectors/multi-page";

export const MARYLAND_SOURCE_URL = "https://msac.org/programs/grants-organizations";
export const MARYLAND_SOURCE_HOST = "msac.org";
export const MARYLAND_APPROVED_HOSTS: readonly string[] = ["msac.org", "www.msac.org"];
/** The publishing body, in the page's own words (the Council's own site header). */
export const MARYLAND_AGENCY = "Maryland State Arts Council";
export const MARYLAND_SOURCE_NAME = "Maryland State Arts Council — Grants for Organizations (GFO)";
export const MARYLAND_CONNECTOR_ID = "md-msac-grants-organizations";
export const MARYLAND_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/maryland.source-validation.test.ts";

/** The index's own sentence that introduces the programme (the corpus marker). */
export const MARYLAND_INDEX_MARKER = "Grants for Organizations (GFO) provide operating support";
/** The Council's own name for the programme family (its h1, plus its (GFO)). */
export const MARYLAND_PROGRAM_TITLE = "Grants for Organizations (GFO)";
/** The label the Council publishes above the one date a GFO page carries. */
export const MARYLAND_DEADLINE_LABEL = "Deadline";
/** The box that label lives in — the source's own name for the block. */
export const MARYLAND_QUICK_RESOURCES_HEADING = "Quick Resources";
/** Only the GFO programme pages are read — never a GFO index sibling family. */
export const MARYLAND_GFO_PATH_PREFIX = "/programs/grants-organizations/";
/** Today the index publishes two GFO pages; more than this fails loudly. */
export const MARYLAND_MAX_CHILD_PAGES = 8;

// ── The index's own list of GFO programme pages ──────────────────────────────

const ANCHOR_RE = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
/** Link text that names no programme ("Read more.", "Learn More"): never a name. */
const GENERIC_LINK_TEXT_RE = /^(?:read more|learn more|more|view|apply here|click here)\.?$/i;

export interface MarylandGfoPage {
  /** Absolute URL on the approved host (normalised onto msac.org). */
  url: string;
  /** The Council's own link text for the page, e.g. "New GFO Applicants". */
  name: string;
}

/**
 * Every GFO programme page the index publishes, in the index's own document order.
 * A generic button ("Read more.") does not name a page, so it never becomes one;
 * a link that leaves the GFO path, the approved hosts, or names the path's own
 * index is not a programme page either.
 */
export function marylandGfoPages(indexHtml: string): MarylandGfoPage[] {
  const out: MarylandGfoPage[] = [];
  const seen = new Set<string>();
  for (const m of indexHtml.matchAll(new RegExp(ANCHOR_RE.source, "gi"))) {
    const href = decodeEntities(m[1] ?? "").trim();
    const name = stripTags(m[2] ?? "");
    if (href.length === 0 || name.length === 0) continue;
    let url: URL;
    try {
      // The Council's own markup links its pages over plain http; the connector
      // reads https and normalises the bare host onto the approved canonical one.
      url = new URL(href, MARYLAND_SOURCE_URL);
    } catch {
      continue;
    }
    if (!MARYLAND_APPROVED_HOSTS.includes(url.host)) continue;
    if (!url.pathname.startsWith(MARYLAND_GFO_PATH_PREFIX)) continue;
    const slug = url.pathname.slice(MARYLAND_GFO_PATH_PREFIX.length).replace(/^\/+|\/+$/g, "");
    if (slug.length === 0 || slug.includes("/")) continue;
    if (url.host === "www.msac.org") url.host = "msac.org";
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    const key = url.toString();
    const named = GENERIC_LINK_TEXT_RE.test(name) ? null : name;
    const existing = out.find((p) => p.url === key);
    if (existing) {
      // The first anchor for a URL wins UNLESS it was only a generic button and a
      // later anchor on the same page names the programme.
      if (existing.name.length === 0 && named !== null) existing.name = named;
      continue;
    }
    seen.add(key);
    out.push({ url: key, name: named ?? "" });
  }
  return out;
}

// ── The labelled deadline blocks ─────────────────────────────────────────────

/** A heading element, in the source's own markup. */
const HEADING_RE = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
/** The paragraph carrying the programme's year-less prose deadline wording. */
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
/** How far past its own heading a labelled value may sit. */
const LABELLED_VALUE_WINDOW = 600;
/** Markers that end the labelled value's OWN block, never a sibling's. */
const MARYLAND_BLOCK_END_MARKERS: readonly string[] = ["</aside>", "aside__section"];

interface LabelledDeadline {
  /** The value text between this label and the end of its block, verbatim. */
  valueText: string;
  /** The single published day that value resolves to, or null. */
  day: string | null;
}

/**
 * Every block on a page that the source itself labels `Deadline`, with the value
 * read from that block's own window. The window stops at the NEXT heading, at the
 * next section and at the end of the box, so one block's value can never be read
 * out of a sibling block (the DC NO-GO cause).
 */
export function marylandLabelledDeadlines(html: string): LabelledDeadline[] {
  const out: LabelledDeadline[] = [];
  const headings = [...html.matchAll(new RegExp(HEADING_RE.source, "gi"))];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    const label = stripTags(h[1] ?? "");
    if (!new RegExp(`^${MARYLAND_DEADLINE_LABEL}\\.?$`, "i").test(label)) continue;
    const start = (h.index ?? 0) + h[0].length;
    let end = Math.min(
      start + LABELLED_VALUE_WINDOW,
      headings[i + 1]?.index ?? Number.POSITIVE_INFINITY,
    );
    for (const stop of MARYLAND_BLOCK_END_MARKERS) {
      const at = html.indexOf(stop, start);
      if (at !== -1 && at < end) end = at;
    }
    // An unterminated tag at a slice edge is markup, not a value: drop it, so a
    // truncated window can never leak raw tag text into a displayed field.
    const valueText = stripTags(html.slice(start, end).replace(/<[^>]*$/, ""));
    out.push({ valueText, day: singlePublishedDay(valueText) });
  }
  return out;
}

/** The Council's own h1 for a page ("<h1><span>New GFO Applicants</span>"). */
function marylandPageTitle(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const text = m ? stripTags(m[1] ?? "") : "";
  return text.length > 0 ? text : null;
}

/**
 * The page's own prose sentence about the application, carried in `raw` so a
 * reviewer can see the year-less wording the connector deliberately does not read.
 */
function marylandApplicationProse(html: string): string | null {
  for (const m of html.matchAll(new RegExp(PARAGRAPH_RE.source, "gi"))) {
    const text = stripTags(m[1] ?? "");
    if (/\bIntent to Apply\b/.test(text)) return text;
  }
  return null;
}

/**
 * Parses the GFO index + the programme pages it publishes into UNCLASSIFIED
 * records — one per source-labelled `Deadline` block, each read from its OWN page.
 */
export function parseMarylandGfoPages(payload: string): SourceGrantRecord[] {
  if (typeof payload !== "string" || !payload.includes(MARYLAND_INDEX_MARKER)) {
    throw new StateSourceError(
      "parse",
      `Maryland source payload is not the expected MSAC Grants for Organizations corpus (marker ${JSON.stringify(
        MARYLAND_INDEX_MARKER,
      )} missing)`,
    );
  }
  const pages = splitSourcePages(payload);
  const indexPage =
    pages.find((p) => p.url === MARYLAND_SOURCE_URL) ??
    pages.find((p) => marylandGfoPages(p.html).length > 0);
  const programmePages = indexPage ? marylandGfoPages(indexPage.html) : [];
  const nameByUrl = new Map(programmePages.map((p) => [p.url, p.name] as const));
  const nextId = uniqueExternalIdFactory();
  const records: SourceGrantRecord[] = [];

  for (const page of pages) {
    // The GFO index publishes programme copy and no cycle of its own, and a page
    // we cannot attribute to a URL is not part of this corpus.
    if (page.url.length === 0 || page.url === MARYLAND_SOURCE_URL) continue;
    const blocks = marylandLabelledDeadlines(page.html);
    if (blocks.length === 0) continue; // no labelled deadline ⇒ no record at all
    // The Council's own h1 names the page; the index's card text is the fallback.
    const cardName = nameByUrl.get(page.url) ?? "";
    const pageTitle = marylandPageTitle(page.html);
    const programmeName = pageTitle ?? (cardName.length > 0 ? cardName : null);
    if (programmeName === null) continue;
    const idBase =
      externalIdFromPath(page.url, ["programs/grants-organizations/"]) ??
      programmeName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const prose = marylandApplicationProse(page.html);

    blocks.forEach((block, blockIndex) => {
      records.push({
        sourceKey: MARYLAND_CONNECTOR_ID,
        stateCode: "MD",
        externalId: nextId(blocks.length === 1 ? idBase : `${idBase}-${blockIndex + 1}`),
        // The Council's own programme name first, then its own name for the page.
        title: `${MARYLAND_PROGRAM_TITLE} — ${programmeName}`,
        agency: MARYLAND_AGENCY,
        summary: NOT_SPECIFIED,
        // The page that published this deadline — never the index, never a sibling.
        url: page.url,
        sourceUrl: MARYLAND_SOURCE_URL,
        // The Council labels a deadline, not an opening date.
        postedDate: null,
        closeDate: block.day,
        estimatedCloseDate: null,
        // The Council publishes no "rolling"/year-round wording for GFO.
        ongoing: false,
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
          childPageUrl: page.url,
          programmeName,
          indexCardName: cardName.length > 0 ? cardName : null,
          // The source's own label and value, verbatim.
          deadlineLabel: MARYLAND_DEADLINE_LABEL,
          labelledBySource: true,
          quickResourcesHeading: MARYLAND_QUICK_RESOURCES_HEADING,
          deadlineValueText: block.valueText,
          applicationDueDateText: block.valueText,
          closingText: block.valueText,
          closingDayPublishedBySource: block.day,
          // The year-less prose the Council publishes, kept for review and NEVER
          // read as a deadline (it carries no year, so it cannot be).
          applicationWindowProseText: prose,
          yearLessProseDeadlinesNeverRead: true,
          // The index's own dates (its 2021 formula-adoption token, its FY labels)
          // are governance/history and are never cycle dates.
          indexDatesAreGovernanceHistory: true,
          // The deadline is read from THIS page's own labelled block.
          datesReadOnlyFromThisPagesOwnBlock: true,
          rollingDeclaredBySource: false,
          sourceClosedDeclaredBySource: false,
        },
      });
    });
  }

  if (records.length === 0) {
    throw new StateSourceError(
      "parse",
      "Maryland Grants for Organizations pages parsed to zero labelled deadlines — the Quick Resources block changed shape, refusing to report an empty corpus",
    );
  }
  return records;
}

/** The classifier this connector uses, unmodified (owner status model). */
export function classifyMarylandRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

export const marylandConnector: StateGrantConnector<string> = {
  id: MARYLAND_CONNECTOR_ID,
  stateCode: "MD",
  stateName: "Maryland",
  sourceName: MARYLAND_SOURCE_NAME,
  agency: MARYLAND_AGENCY,
  sourceUrl: MARYLAND_SOURCE_URL,
  officialHost: MARYLAND_SOURCE_HOST,
  sourceValidationTest: MARYLAND_SOURCE_VALIDATION_TEST,
  async fetch() {
    return fetchStateGrantPages({
      indexUrl: MARYLAND_SOURCE_URL,
      marker: MARYLAND_INDEX_MARKER,
      label: "Maryland State Arts Council Grants for Organizations",
      approvedHosts: MARYLAND_APPROVED_HOSTS,
      minBytes: 4000,
      childMinBytes: 2000,
      maxChildren: MARYLAND_MAX_CHILD_PAGES,
      childUrls: (indexHtml) => marylandGfoPages(indexHtml).map((p) => p.url),
    });
  },
  parse(raw: string) {
    return parseMarylandGfoPages(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyMarylandRecord(record, now);
  },
};
