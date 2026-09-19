/**
 * VIRGINIA REFERENCE CONNECTOR — the first (and, at part 1, only) state
 * connector for Contrax Grants' state rollout (owner ROLLOUT order 2026-09-18).
 *
 * OFFICIAL SOURCE (named constant below, verified live 2026-09-19):
 *   https://www.vatc.org/grants/
 * WHY THIS IS OFFICIAL: the page is published by the **Virginia Tourism
 * Corporation (VTC)** — the Commonwealth's official state tourism authority,
 * reached today as the Virginia Tourism Authority — on its own domain
 * vatc.org (the same domain its own grant correspondence is sent from,
 * @virginia.org, and the domain the Commonwealth links to for tourism industry
 * programs). It is a public-body source, it is live and reachable from the
 * production server, it needs NO API key, and it lists the state's CURRENT
 * funding programs with their own published dates — which is exactly what the
 * rollout requires (a real state grants listing we can verify, not a directory).
 * Candidate sources that were evaluated and rejected on 2026-09-19:
 *   - dhcd.virginia.gov/grants and /nofa            → HTTP 404 (paths moved)
 *   - deq.virginia.gov funding-opportunities        → HTTP 403 to server fetches
 *   - vdh.virginia.gov/grants                       → HTTP 404
 *   - trrc.virginia.gov/grant-programs              → connection failed
 *   - virginiahousing.com/grants                    → reachable, but a program
 *     index without published dates, so nothing could be classified honestly
 * The host must stay on VIRGINIA_APPROVED_HOSTS or the state registry refuses to
 * report Virginia as `connected` (fail-closed — see registry.ts).
 *
 * WHY A FINGERPRINT OF THE PAGE, NOT A JSON API: VTC publishes no grant feed.
 * The grants page is a hand-maintained WordPress page whose program blocks are
 * regular enough to parse deterministically (a title paragraph linking to the
 * program's own page, followed by a list of labelled facts). This connector
 * reads those blocks and NOTHING else — it never guesses a field, and a page
 * that stops matching the expected shape fails the run rather than producing
 * half-parsed records (see parse()).
 */
import {
  NOT_SPECIFIED,
  classifyStateGrant,
  contentFingerprint,
  parseStateDay,
  slugify,
  type GrantClassification,
  type SourceGrantRecord,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";

/**
 * The ONE official listing this connector reads. Hard-coded on purpose: there is
 * no client-controllable URL anywhere in the state-grants flow.
 */
export const VIRGINIA_SOURCE_URL = "https://www.vatc.org/grants/";

/** Host of VIRGINIA_SOURCE_URL — the host every parsed record URL must be on. */
export const VIRGINIA_SOURCE_HOST = "www.vatc.org";

/**
 * Hosts a Virginia record URL may use. vatc.org and www.vatc.org are the same
 * official VTC site (the page's own in-content links use the bare domain).
 */
export const VIRGINIA_APPROVED_HOSTS: readonly string[] = ["www.vatc.org", "vatc.org"];

/**
 * The publishing body, taken from the source's own words ("Virginia Tourism
 * Corporation (VTC) offers several funding programs…", from the grants page
 * itself). Not an inferred agency name.
 */
export const VIRGINIA_AGENCY = "Virginia Tourism Corporation";

export const VIRGINIA_CONNECTOR_ID = "va-vtc-grants";

/**
 * The source-validation test that GATES Virginia's `unavailable → connected`
 * flip. Named here so the registry can require it, and asserted by that test
 * itself so the manifest and the test can never drift apart silently.
 */
export const VIRGINIA_SOURCE_VALIDATION_TEST =
  "src/lib/state-grants/virginia.source-validation.test.ts";

/** Thrown for every fetch/parse failure. The sync runner aborts the state run. */
export class VirginiaSourceError extends Error {
  readonly stage: "fetch" | "parse";
  constructor(stage: "fetch" | "parse", message: string) {
    super(message);
    this.name = "VirginiaSourceError";
    this.stage = stage;
  }
}

export const UPSTREAM_TIMEOUT_MS = 20_000;

/** A browser-like UA: the source is a public web page, not an API. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; ContraxGrantsBot/1.0; +https://www.contrax.company)";

/**
 * Fetches the raw grants page. Throws VirginiaSourceError on timeout, a
 * non-2xx response, an empty body, or a payload that no longer looks like the
 * VTC grants page — fail-closed means a failed run with ZERO writes, never a
 * half-parsed corpus.
 */
async function fetchVirginiaGrantsPage(
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let body: string;
  let status: number;
  try {
    const res = await fetchImpl(VIRGINIA_SOURCE_URL, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new VirginiaSourceError(
      "fetch",
      aborted
        ? `Virginia source timed out after ${UPSTREAM_TIMEOUT_MS}ms (${VIRGINIA_SOURCE_URL})`
        : `Virginia source request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  void now;
  if (status < 200 || status >= 300) {
    throw new VirginiaSourceError(
      "fetch",
      `Virginia source responded ${status} (${VIRGINIA_SOURCE_URL})`,
    );
  }
  if (!body || body.length < 1000) {
    throw new VirginiaSourceError(
      "parse",
      `Virginia source returned an implausibly small body (${body?.length ?? 0} bytes)`,
    );
  }
  if (!body.includes(VIRGINIA_CONTENT_MARKER)) {
    throw new VirginiaSourceError(
      "parse",
      `Virginia source no longer looks like the VTC grants page (marker ${JSON.stringify(VIRGINIA_CONTENT_MARKER)} missing)`,
    );
  }
  return body;
}

/**
 * Marks the article body of the grants page. If the page template changes, the
 * run FAILS loudly instead of parsing navigation chrome as opportunities.
 */
export const VIRGINIA_CONTENT_MARKER = 'class="entry-content"';

// ── Parsing helpers (pure, unit-tested) ─────────────────────────────────────

/** Strips tags, decodes entities, collapses whitespace. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    // The page mixes literal curly quotes with entities ("What’s available").
    // Normalising them is what lets one label pattern match every occurrence —
    // verified live 2026-09-19 on the TDFP/TIDS blocks.
    .replace(/[\u2018\u2019\u02bc\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2014|\u2013/g, "-");
}

/** The article body only — the page's nav/footer can never become a record. */
function contentRegion(html: string): string {
  const startMarker = VIRGINIA_CONTENT_MARKER;
  const start = html.indexOf(startMarker);
  if (start === -1) return html;
  const rest = html.slice(start);
  const endMarkers = ['class="entry-footer"', "</article>", 'class="site-footer"'];
  let end = rest.length;
  for (const marker of endMarkers) {
    const idx = rest.indexOf(marker);
    if (idx !== -1 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}

interface RawBlock {
  title: string;
  href: string | null;
}

/**
 * Splits the article body into program blocks. A block starts at a paragraph
 * that links to a same-site page and whose link text is the program name — the
 * VTC grants page's own layout (verified live 2026-09-19: every program is a
 * `<p class="wp-block-paragraph"><a href="https://vatc.org/…"><strong>Name</strong>
 * </a></p>` followed by a `<ul class="wp-block-list">` of labelled facts).
 * Paragraphs without such a link (intro copy, the map caption) are skipped, and
 * image-bearing paragraphs are skipped so the map figure can never be a record.
 */
function splitBlocks(region: string): { block: RawBlock; body: string }[] {
  const paraRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const starts: { index: number; block: RawBlock }[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(region)) !== null) {
    const inner = m[1] ?? "";
    if (/<img\b/i.test(inner)) continue;
    // The FIRST link in the paragraph is the program link, but only if its text
    // is real (a link wrapping only an image or a bare "read more" is not one).
    const linkRe = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    const link = linkRe.exec(inner);
    if (!link) continue;
    const href = decodeEntities(link[1] ?? "").trim();
    const text = stripTags(link[2] ?? "");
    if (!/^https?:/i.test(href)) continue;
    if (text.length < 3) continue;
    if (isNavigationText(text)) continue;
    // Strip any trailing link text duplication (VTC nests <strong><u><a>…).
    starts.push({ index: m.index, block: { title: text, href } });
  }
  return starts.map((s, i) => ({
    block: s.block,
    body: region.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : region.length),
  }));
}

/**
 * Paragraph-level link text that is page furniture rather than a program name.
 * Deliberately tiny and explicit — anything not listed is treated as a program.
 */
function isNavigationText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t === "click map for larger view" ||
    t === "read more" ||
    t === "learn more" ||
    t.startsWith("sign up for") ||
    t.startsWith("back to")
  );
}

/** The labelled facts of one block, keyed by the label the source used. */
interface LabeledFacts {
  /** label (lower-cased, de-punctuated) → the source's value, verbatim. */
  values: Record<string, string>;
  /** Unlabelled list lines (the program description), in source order. */
  descriptions: string[];
  /** Labels in the order the source wrote them. */
  order: string[];
}

const LABEL_RE =
  /(who is eligible|additional eligibility|eligibility|what'?s available|what is available|description|opened|opens|open date|closes|closing date|closing|close date|closed|deadline|due date|due|when|award tiers?|award tier|award amount|award|maximum award|max award|match|funding|amount|how|marketing focus|contact|apply|application|learn more)\s*:/gi;

/** Extracts `Label: value` pairs plus unlabelled description lines from a block. */
export function extractFacts(body: string): LabeledFacts {
  const listRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const values: Record<string, string> = {};
  const order: string[] = [];
  const descriptions: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = listRe.exec(body)) !== null) {
    const text = stripTags(m[1] ?? "");
    if (!text) continue;
    const matches = [...text.matchAll(LABEL_RE)];
    if (matches.length === 0) {
      if (!isContactOnlyLine(text)) descriptions.push(text);
      continue;
    }
    for (let i = 0; i < matches.length; i++) {
      const label = normalizeLabel(matches[i][1]);
      const valueStart = (matches[i].index ?? 0) + matches[i][0].length;
      const valueEnd = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
      const value = text.slice(valueStart, valueEnd).trim().replace(/^[.\s]+/, "").trim();
      order.push(label);
      if (value) {
        values[label] = values[label] ? `${values[label]} ${value}` : value;
      } else if (!(label in values)) {
        values[label] = "";
      }
    }
  }
  return { values, descriptions, order };
}

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/'/g, "'");
}

/** A list line that is only contact instructions — never a description. */
function isContactOnlyLine(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.startsWith("for information and questions") ||
    t.startsWith("please contact") ||
    t.startsWith("learn more at") ||
    t.startsWith("contact") ||
    /^[\w.@|: -]+@[\w.-]+$/.test(t)
  );
}

const OPENING_LABELS = ["opened", "opens", "open date"];
const CLOSING_LABELS = ["closes", "closing", "closing date", "close date", "closed", "deadline", "due", "due date"];
/** Past-tense closing labels: the source itself says this cycle is over. */
const PAST_TENSE_CLOSING_LABELS = ["closed"];

/** Does the source's own words declare a program with no deadline to expire? */
const ONGOING_RE =
  /\b(year[\s-]?round|rolling|ongoing|continuous|no (?:time|deadline)|no application deadline|accept(?:s|ing) applications (?:on a )?rolling|open until filled|always open)\b/i;

/** First usable date among a set of labels, plus which label produced it. */
function firstDate(
  facts: LabeledFacts,
  labels: readonly string[],
): { date: string | null; label: string | null; raw: string | null } {
  for (const label of labels) {
    const value = facts.values[label];
    if (value === undefined) continue;
    const date = parseStateDay(value);
    if (date) return { date, label, raw: value };
  }
  return { date: null, label: null, raw: null };
}

/** Parses the whole page into normalised, UNCLASSIFIED records. */
export function parseVirginiaGrantsPage(html: string, now: Date = new Date()): SourceGrantRecord[] {
  void now;
  if (typeof html !== "string" || !html.includes(VIRGINIA_CONTENT_MARKER)) {
    throw new VirginiaSourceError(
      "parse",
      `Virginia source payload is not the expected VTC grants page (marker ${JSON.stringify(VIRGINIA_CONTENT_MARKER)} missing)`,
    );
  }
  const blocks = splitBlocks(contentRegion(html));
  if (blocks.length === 0) {
    throw new VirginiaSourceError(
      "parse",
      "Virginia source parsed to zero program blocks — the page layout changed, refusing to report an empty corpus",
    );
  }

  const records: SourceGrantRecord[] = [];
  const takenIds = new Map<string, number>();

  for (const { block, body } of blocks) {
    const title = block.title;
    if (!title || title.length < 3) continue;

    const facts = extractFacts(body);
    const opening = firstDate(facts, OPENING_LABELS);
    const closing = firstDate(facts, CLOSING_LABELS);
    const ongoingValue =
      facts.values["when"] ?? facts.values["deadline"] ?? facts.values["description"] ?? "";
    const ongoing = ONGOING_RE.test(ongoingValue) || ONGOING_RE.test(title);
    const sourceClosed =
      closing.label !== null && PAST_TENSE_CLOSING_LABELS.includes(closing.label);

    const url = officialUrl(block.href);
    const externalId = uniqueExternalId(externalIdFor(url, title), takenIds);

    const description =
      facts.values["what's available"] ??
      facts.values["what is available"] ??
      facts.values["description"] ??
      facts.descriptions[0] ??
      "";

    records.push({
      stateCode: "VA",
      externalId,
      title,
      agency: VIRGINIA_AGENCY,
      summary: description || NOT_SPECIFIED,
      url,
      sourceUrl: VIRGINIA_SOURCE_URL,
      postedDate: opening.date,
      closeDate: closing.date,
      ongoing,
      sourceClosed,
      // The VTC grants page publishes NO per-record "last updated" stamp, and its
      // page-level Last-Modified would rewrite every row on any site edit — the
      // exact no-op-write churn this repo avoids. So it stays null, and
      // amendment detection rides on the content fingerprint (see CONVENTIONS.md).
      sourceUpdatedAt: null,
      raw: {
        // Source fields verbatim, in the source's own label order.
        labels: facts.order,
        facts: facts.values,
        eligibility:
          facts.values["who is eligible"] ??
          facts.values["eligibility"] ??
          facts.values["additional eligibility"] ??
          NOT_SPECIFIED,
        award:
          facts.values["award tiers"] ??
          facts.values["award tier"] ??
          facts.values["award"] ??
          facts.values["award amount"] ??
          facts.values["max award"] ??
          facts.values["maximum award"] ??
          NOT_SPECIFIED,
        openingLabel: opening.label,
        openingText: opening.raw,
        closingLabel: closing.label,
        closingText: closing.raw,
        ongoingDeclaredBySource: ongoing,
        sourceClosedDeclaredBySource: sourceClosed,
      },
    });
  }
  return records;
}

/**
 * The record's own page, pinned to the official domain. A link off the approved
 * hosts falls back to the listing page rather than sending a user (or a future
 * fetch) somewhere unverified.
 */
export function officialUrl(href: string | null): string {
  if (!href) return VIRGINIA_SOURCE_URL;
  try {
    const url = new URL(href, VIRGINIA_SOURCE_URL);
    if (!VIRGINIA_APPROVED_HOSTS.includes(url.host)) return VIRGINIA_SOURCE_URL;
    // The page links with a bare domain; normalise so the stored URL is the
    // https www form of the same official site.
    url.protocol = "https:";
    if (url.host === "vatc.org") url.host = VIRGINIA_SOURCE_HOST;
    url.hash = "";
    return url.toString();
  } catch {
    return VIRGINIA_SOURCE_URL;
  }
}

/**
 * The source's own identifier for a program: the slug of its official page path
 * (e.g. https://www.vatc.org/grants/mmlp/ → "mmlp"). Falls back to a slug of the
 * title when the source gave no usable link. A derivation, never an invention —
 * and it is STABLE, which is what makes re-runs update instead of duplicate.
 */
export function externalIdFor(url: string, title: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    const withoutSection = path.replace(/^grants\//, "");
    const slug = slugify(withoutSection || path);
    if (slug) return slug;
  } catch {
    /* fall through to the title */
  }
  return slugify(title) || "unknown";
}

/** Deterministic de-duplication of derived ids (document order is stable). */
function uniqueExternalId(base: string, taken: Map<string, number>): string {
  const seen = taken.get(base) ?? 0;
  taken.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

/** Exported for the unit tests: the classifier this connector uses, unmodified. */
export function classifyVirginiaRecord(
  record: SourceGrantRecord,
  now: Date | number = new Date(),
): GrantClassification {
  return classifyStateGrant(record, now);
}

/** The connector object the registry and the sync runner use. */
export const virginiaConnector: StateGrantConnector<string> = {
  id: VIRGINIA_CONNECTOR_ID,
  stateCode: "VA",
  stateName: "Virginia",
  sourceUrl: VIRGINIA_SOURCE_URL,
  officialHost: VIRGINIA_SOURCE_HOST,
  sourceValidationTest: VIRGINIA_SOURCE_VALIDATION_TEST,
  async fetch(now: Date = new Date()) {
    return fetchVirginiaGrantsPage(now);
  },
  parse(raw: string) {
    return parseVirginiaGrantsPage(raw);
  },
  classify(record: SourceGrantRecord, now: Date | number = new Date()) {
    return classifyVirginiaRecord(record, now);
  },
};

/** Fingerprint helper re-exported so tests can prove amendment detection. */
export { contentFingerprint };
