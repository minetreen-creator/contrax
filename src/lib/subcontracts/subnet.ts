/**
 * Contrax — SUBCONTRACTING preview, DATA LAYER: the SUBNet crawler + parser
 * (owner directive 2026-09-25, BUILD-PLAN.md §6.1–6.2).
 *
 * WHAT THIS READS. SBA SUBNet, the only public board of open prime-posted
 * subcontracting opportunities:
 *   index  GET …/subcontracting-opportunities?keyword=&state=All&op=contains&page=N
 *          (Drupal views pager, 10 rows/page, 0-indexed, plain server-rendered HTML)
 *   detail GET /opportunity/<slug>   (one page per notice: division, website, full
 *          description, the certifications solicited, attachments, POC)
 * There is no API, no JSON, no RSS and no export — verified 2026-09-25 by probing
 * `?_format=json` (406), `/jsonapi` (404), `/rss.xml` (404), `/search/opportunities`
 * (404) and by grepping the page for any api/json/export/feed URL (none).
 *
 * ROBOTS + VOLUME. legacy.sba.gov/robots.txt disallows /admin/, /search/,
 * /user/*, /media/oembed and /sites/default/files/* — the SUBNet index and every
 * /opportunity/<slug> page are NOT disallowed, so they are crawled. This module
 * therefore never requests a `/sites/default/files/*` path: attachments are recorded
 * as name + size only, never mirrored or linked-through. Requests are serialised at
 * one per second (SUBNET_REQUEST_INTERVAL_MS) with a descriptive UA, so a full sweep
 * is ~15 index requests plus one detail request per NEW notice.
 *
 * THE DATE TRAP THIS FILE EXISTS TO NOT REPEAT. The recon probe behind BUILD-PLAN.md
 * matched closing dates with /(\d{2})\/(\d{2})\/(\d{4})/ — TWO-DIGIT-ONLY — so every
 * single-digit date ("9/29/2026", "10/5/2026") read as "no closing date" and the plan
 * concluded that 91 of 141 notices (65 %) carry no closing date. They all carry one.
 * Re-measured 2026-09-25 15:57Z: 141 notices, 141 closing dates, 0 past due, 11
 * closing that same day. This module uses the shared tolerant parser
 * (parseStateDay) and its own fixture test pins the single-digit case.
 *
 * FAIL-CLOSED. A page that has neither a notice table NOR the source's own
 * `no-results` marker is a PARSE ERROR, never an empty corpus: a Drupal theme change
 * must fail the run loudly (which writes nothing) instead of silently emptying the
 * product. The same applies to a detail page whose details region is gone, and to a
 * crawl that parses zero notices overall.
 */
import {
  SUBNET_SOURCE,
  dedupeNotices,
  crawlShouldStop,
  listedScopes,
  splitNaics,
  stateCodeForPlace,
  type SubcontractAttachment,
  type SubcontractNotice,
} from "~/lib/subcontracts/connector";
import { parseStateDay } from "~/lib/state-grants/connector";

export const SUBNET_INDEX_URL = SUBNET_SOURCE.officialUrl;
export const SUBNET_DETAIL_BASE = "https://legacy.sba.gov/opportunity/";
/** Hosts this crawler may request (fail-closed; the list is code, not input). */
export const SUBNET_APPROVED_HOSTS = ["legacy.sba.gov", "www.sba.gov"] as const;
/** Descriptive UA — the crawler identifies itself and links the product page. */
export const SUBNET_USER_AGENT =
  "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company/subcontracts)";
/** One request per second, never a burst (robots-friendly, and the recon's 12-request
 * burst test showed no rate limiting — being polite is our choice, not a requirement). */
export const SUBNET_REQUEST_INTERVAL_MS = 1000;
export const SUBNET_FETCH_TIMEOUT_MS = 20_000;
export const SUBNET_MAX_ATTEMPTS = 3;
/** 141 notices / 10 rows per page = 15 pages on 2026-09-25. The cap is the safety net
 * for the pager's "past the end redisplayed page 1" behaviour — never a stopping rule
 * by itself, and never a "total pages" assumption (the HTML publishes no such number). */
export const SUBNET_PAGE_CAP = 40;

/** A page that cannot be read as a SUBNet page. Always fatal to the run. */
export class SubnetParseError extends Error {
  readonly stage = "parse" as const;
  constructor(message: string) {
    super(message);
    this.name = "SubnetParseError";
  }
}

/** A request that failed after every attempt. Always fatal to the run. */
export class SubnetFetchError extends Error {
  readonly stage = "fetch" as const;
  constructor(message: string, readonly url: string, readonly status: number | null) {
    super(message);
    this.name = "SubnetFetchError";
  }
}

// ── Text helpers (no DOM library: the repo's connector rule) ──────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  deg: "°",
};

/** Decodes the entities SBA's Drupal output actually uses (numeric forms included). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const known = ENTITIES[body.toLowerCase()];
    return known ?? match;
  });
}

/** HTML → single-line text: block tags become spaces, entities decoded, collapsed. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML → multi-line text: `</p>`, `<br>` and block ends become newlines. */
export function paragraphsOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|li|h\d)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * The value of a `<div class="… fieldClass …">…</div>` field, minus its label.
 *
 * The class boundary is `(?<![\w-])…(?![\w-])`, NOT `\b`: a `\b` matches before the
 * hyphen in `sba-subnet__poc-phone`, so `fieldValue(section, "sba-subnet__poc")` would
 * happily return the PHONE field whenever it appears first. The contact section nests
 * exactly those three classes (`__poc`, `__poc-phone`, `__poc-email`), so the strict
 * boundary is what makes each one addressable (verified against the live page).
 */
function fieldValue(html: string, fieldClass: string): string | null {
  const re = new RegExp(
    `class="[^"]*(?<![\\w-])${fieldClass}(?![\\w-])[^"]*"[^>]*>([\\s\\S]*?)</div>`,
  );
  const m = re.exec(html);
  if (!m) return null;
  const withoutLabel = m[1]!.replace(/<span class="text-bold">[\s\S]*?<\/span>/g, " ");
  const value = textOf(withoutLabel);
  return value.length > 0 ? value : null;
}

/**
 * The `href` of the first anchor inside a named field div. Same strict class
 * boundary as fieldValue() — see the comment there (`…__poc` must not read the
 * `…__poc-phone` div).
 */
function fieldHref(html: string, fieldClass: string, scheme: string): string | null {
  const re = new RegExp(
    `class="[^"]*(?<![\\w-])${fieldClass}(?![\\w-])[^"]*"[^>]*>([\\s\\S]*?)</div>`,
  );
  const m = re.exec(html);
  if (!m) return null;
  const href = new RegExp(`href="(${scheme}:?[^"]*)"`).exec(m[1]!);
  return href ? decodeEntities(href[1]!) : null;
}

/** `<div class="sba-subnet__section sba-subnet__section__x">…` → name → inner HTML. */
function sectionBodies(html: string): Map<string, string> {
  const parts = html.split(/<div class="sba-subnet__section\s+([^"]*)"/);
  const bodies = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) {
    const classes = parts[i] ?? "";
    const body = parts[i + 1] ?? "";
    const name = /sba-subnet__section__([a-z-]+)/.exec(classes)?.[1];
    if (name && !bodies.has(name)) bodies.set(name, body);
  }
  return bodies;
}

// ── The index page ───────────────────────────────────────────────────────────

export interface SubnetIndexRow {
  externalId: string;
  detailUrl: string;
  title: string;
  prime: string;
  description: string | null;
  closingRaw: string | null;
  performanceStartRaw: string | null;
  placeRaw: string | null;
  naicsRaw: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface SubnetIndexPage {
  rows: SubnetIndexRow[];
  /** The source's own `no-results` marker: this page is past the end of the pager. */
  emptyMarker: boolean;
}

export function subnetIndexUrl(page: number): string {
  return `${SUBNET_INDEX_URL}?keyword=&state=All&op=contains&page=${page}`;
}

/** The `<td>` whose `headers` attribute carries the given views-field key. */
function cellByHeader(rowHtml: string, headerKey: string): string | null {
  const re = new RegExp(
    `<td[^>]*headers="[^"]*${headerKey}[^"]*"[^>]*>([\\s\\S]*?)</td>`,
  );
  const m = re.exec(rowHtml);
  return m ? m[1]! : null;
}

/**
 * Parses one index page.
 *
 * Throws when the page is neither a notice table nor the source's own empty marker:
 * that combination means the board's markup changed, and reading it as "no
 * opportunities" is exactly the fabrication this feature must never make.
 */
export function parseSubnetIndexPage(html: string): SubnetIndexPage {
  const emptyMarker = /class="no-results"[^>]*>\s*No opportunities found/i.test(html);
  const tableMatch = /<table class="usa-table cols-6"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!tableMatch) {
    if (emptyMarker) return { rows: [], emptyMarker: true };
    throw new SubnetParseError(
      "the SUBNet index page carries neither the notice table (usa-table cols-6) nor the source's `no-results` marker — the page shape changed, so this run must not record an empty board",
    );
  }
  const rows: SubnetIndexRow[] = [];
  for (const match of tableMatch[1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = match[1]!;
    const anchor = /<a href="(\/opportunity\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(rowHtml);
    if (!anchor) continue; // the <thead> row
    const href = anchor[1]!;
    const externalId = href.split("/").filter(Boolean).pop() ?? "";
    if (!externalId) continue;
    const title = textOf(anchor[2]!);
    const primeMatch = /class="subnet_business_name">([\s\S]*?)<\/span>/.exec(rowHtml);
    const descMatch = /<p>([\s\S]*?)<\/p>/.exec(cellByHeader(rowHtml, "view-body-table-column") ?? "");
    const pocCell = cellByHeader(rowHtml, "view-nothing-table-column") ?? "";
    const pocName = /<a href="mailto:[^"]*">([\s\S]*?)<\/a>/.exec(pocCell);
    const pocEmail = /href="mailto:([^"]+)"/.exec(pocCell);
    const pocPhone = /href="tel:([^"]+)"/.exec(pocCell);
    rows.push({
      externalId,
      detailUrl: `${SUBNET_DETAIL_BASE}${externalId}`,
      title,
      prime: primeMatch ? textOf(primeMatch[1]!) : "",
      description: descMatch ? textOf(descMatch[1]!) || null : null,
      closingRaw: cellByHeader(rowHtml, "field-subnet-closing-timestamp") !== null
        ? textOf(cellByHeader(rowHtml, "field-subnet-closing-timestamp")!) || null
        : null,
      performanceStartRaw: cellByHeader(rowHtml, "field-subnet-start-date") !== null
        ? textOf(cellByHeader(rowHtml, "field-subnet-start-date")!) || null
        : null,
      placeRaw: cellByHeader(rowHtml, "field-subnet-place-performance") !== null
        ? textOf(cellByHeader(rowHtml, "field-subnet-place-performance")!) || null
        : null,
      naicsRaw: cellByHeader(rowHtml, "field-subnet-naics") !== null
        ? textOf(cellByHeader(rowHtml, "field-subnet-naics")!) || null
        : null,
      contactName: pocName ? textOf(pocName[1]!) || null : null,
      contactEmail: pocEmail ? decodeEntities(pocEmail[1]!) : null,
      contactPhone: pocPhone ? decodeEntities(pocPhone[1]!) : null,
    });
  }
  if (rows.length === 0) {
    // A table with no data row is not a page shape we have ever seen; treat the
    // explicit marker as the only legitimate empty signal.
    if (emptyMarker) return { rows: [], emptyMarker: true };
    throw new SubnetParseError(
      "the SUBNet notice table was present but contained no parseable row — refusing to read a markup change as an empty board",
    );
  }
  return { rows, emptyMarker };
}

// ── The detail page ──────────────────────────────────────────────────────────

export interface SubnetDetail {
  division: string | null;
  website: string | null;
  identifier: string | null;
  placeOfPerformance: string | null;
  performanceStartRaw: string | null;
  closingRaw: string | null;
  /** The notice's own description, verbatim (paragraph breaks as newlines). */
  description: string | null;
  /** The notice's own "Project Summary…" block, when it published one. */
  projectSummary: string | null;
  /** "Type of Businesses Being Solicited" — the notice's own list, or []. */
  certsSolicited: string[];
  naicsCode: string | null;
  naicsTitle: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  attachments: SubcontractAttachment[];
}

/**
 * Parses one notice's detail page.
 *
 * Throws when the page has no `sba-subnet__details` region: that region is the whole
 * reason a detail request is spent, so its absence is a shape change, not a notice
 * without a division.
 */
export function parseSubnetDetailPage(html: string): SubnetDetail {
  const detailsIndex = html.indexOf("sba-subnet__details");
  if (detailsIndex < 0) {
    throw new SubnetParseError(
      "the SUBNet detail page has no `sba-subnet__details` region — the page shape changed (or the request did not return a notice), so this record is not stored",
    );
  }
  const sections = sectionBodies(html);
  const detailsRegion = html.slice(detailsIndex, html.indexOf("sba-subnet__section", detailsIndex));
  // THE POINT OF CONTACT IS NOT IN THE DETAILS REGION. The live page renders it in its
  // own sibling section (`sba-subnet__section__contact`, headed "Point of Contact",
  // holding `__poc` / `__poc-phone` / `__poc-email`), which sits AFTER the details
  // region has already ended — so reading the POC out of `detailsRegion` returned null
  // on a page that plainly publishes Name/Phone/Email (live 2026-09-25, fixture
  // verified byte-identical). The details region stays as the fallback so a page that
  // ever inlines the POC beside the closing date is still read.
  const contactRegion = sections.get("contact") ?? detailsRegion;

  const naicsBodies = sections.get("naics") ?? "";
  const naicsCode = /<span class="code">([\s\S]*?)<\/span>/.exec(naicsBodies)?.[1];
  const naicsTitle = /<span class="label">([\s\S]*?)<\/span>/.exec(naicsBodies)?.[1];

  const businessTypes = [...(sections.get("business-type") ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((m) => textOf(m[1]!))
    .filter((value) => value.length > 0);

  const attachments = [
    ...(sections.get("attachments") ?? "").matchAll(
      /<a href="[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span>\(([^)]*)\)<\/span>/g,
    ),
  ].map((m) => ({ name: textOf(m[1]!), size: textOf(m[2]!) || null }));

  const description = paragraphsOf(sections.get("desc") ?? "");
  const summaryIndex = description.search(/project summary\s*:?/i);
  // The notice's own description is one field; when it breaks out a "Project Summary"
  // block we keep the two parts SEPARATE (scope before the block, summary as the
  // block) so the UI never prints the same sentences twice — and the field is null
  // when the notice published no such block.
  const scopeText = summaryIndex > 0 ? description.slice(0, summaryIndex).trim() : description;
  const summaryText = summaryIndex >= 0 ? description.slice(summaryIndex).trim() : "";

  return {
    division: fieldValue(detailsRegion, "sba-subnet__division"),
    website: fieldHref(detailsRegion, "sba-subnet__website", "https"),
    identifier: fieldValue(detailsRegion, "sba-subnet__sol-number"),
    placeOfPerformance: fieldValue(detailsRegion, "sba-subnet__place-performance"),
    performanceStartRaw: fieldValue(detailsRegion, "sba-subnet__start-date"),
    closingRaw: fieldValue(detailsRegion, "sba-subnet__closing-date"),
    description: scopeText.length > 0 ? scopeText : null,
    projectSummary: summaryText.length > 0 ? summaryText : null,
    certsSolicited: businessTypes,
    naicsCode: naicsCode ? textOf(naicsCode) || null : null,
    naicsTitle: naicsTitle ? textOf(naicsTitle) || null : null,
    contactName: fieldValue(contactRegion, "sba-subnet__poc"),
    contactPhone: fieldHref(contactRegion, "sba-subnet__poc-phone", "tel"),
    contactEmail: fieldHref(contactRegion, "sba-subnet__poc-email", "mailto"),
    attachments,
  };
}

// ── Fetching ─────────────────────────────────────────────────────────────────

export type SubnetFetcher = (url: string) => Promise<string>;

/** Rejects any URL outside the approved hosts BEFORE a request is made. */
export function assertApprovedSubnetUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SubnetFetchError("not a URL this crawler may request", url, null);
  }
  if (!(SUBNET_APPROVED_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new SubnetFetchError(
      `host ${parsed.hostname} is not on the SUBNet allowlist — refusing to fetch it`,
      url,
      null,
    );
  }
  if (parsed.pathname.startsWith("/sites/default/files/")) {
    throw new SubnetFetchError(
      "robots.txt disallows /sites/default/files/* — this crawler never requests an attachment path",
      url,
      null,
    );
  }
  return parsed;
}

/**
 * The real HTTP fetcher: descriptive UA, follow redirects, 20 s timeout, up to 3
 * attempts with a short backoff, and a >= 1 s gap between requests (one request per
 * second, serialised). Throws SubnetFetchError when every attempt failed — the run
 * then writes nothing at all.
 */
export function createSubnetFetcher(options: {
  userAgent?: string;
  timeoutMs?: number;
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
} = {}): SubnetFetcher {
  const userAgent = options.userAgent ?? SUBNET_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? SUBNET_FETCH_TIMEOUT_MS;
  const attempts = options.attempts ?? SUBNET_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? SUBNET_REQUEST_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  let lastStartedAt = 0;
  let requests = 0;

  return async (url: string) => {
    assertApprovedSubnetUrl(url);
    let lastError: Error | null = null;
    let lastStatus: number | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (intervalMs > 0) {
        const elapsed = now() - lastStartedAt;
        if (lastStartedAt > 0 && elapsed < intervalMs) await sleep(intervalMs - elapsed);
      }
      lastStartedAt = now();
      requests += 1;
      try {
        const response = await fetch(url, {
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = response.status;
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
        }
        const body = await response.text();
        if (body.trim().length === 0) throw new Error("empty response body");
        return body;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < attempts) await sleep(500 * attempt);
      }
    }
    throw new SubnetFetchError(
      `GET ${url} failed after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`,
      url,
      lastStatus,
    );
  };
}

// ── The crawl ────────────────────────────────────────────────────────────────

export interface SubnetCrawlStats {
  /** Every HTTP request this sweep made (index pages + detail pages). */
  requests: number;
  pagesFetched: number;
  detailsFetched: number;
  detailsSkipped: number;
  stoppedBecause: string;
  durationMs: number;
}

export interface SubnetCrawlResult {
  rows: SubnetIndexRow[];
  details: Map<string, SubnetDetail>;
  collisions: string[];
  stats: SubnetCrawlStats;
}

/**
 * Crawls the index, then fetches the detail page of every notice that is NOT in
 * `skipDetailFor` (the ids a previous complete run already stored) — a re-run of an
 * unchanged board therefore costs ~15 requests and zero detail requests, which is the
 * CU/bandwidth discipline the plan asks for.
 *
 * Fail-closed at three points: an unreadable index page (SubnetParseError), a failed
 * detail request after every retry (SubnetFetchError), and a crawl that parses zero
 * notices. Any of them aborts the run BEFORE a single row is written.
 */
export async function crawlSubnet(options: {
  fetchText?: SubnetFetcher;
  skipDetailFor?: ReadonlySet<string>;
  pageCap?: number;
  now?: Date;
} = {}): Promise<SubnetCrawlResult> {
  const fetchText = options.fetchText ?? createSubnetFetcher();
  const skipDetailFor = options.skipDetailFor ?? new Set<string>();
  const pageCap = options.pageCap ?? SUBNET_PAGE_CAP;
  const startedAt = Date.now();

  const rows: SubnetIndexRow[] = [];
  const seen = new Set<string>();
  const rawById = new Map<string, SubnetIndexRow[]>();
  let pagesFetched = 0;
  let stoppedBecause = "";
  let emptyMarkerSeen = false;

  for (let page = 0; page < pageCap; page++) {
    const html = await fetchText(subnetIndexUrl(page));
    const parsed = parseSubnetIndexPage(html);
    pagesFetched += 1;
    if (page === 0 && parsed.rows.length === 0) {
      throw new SubnetParseError(
        "the FIRST SUBNet index page returned no notice — refusing to record an empty subcontracting corpus (fail-closed: this is a source shape change until proven otherwise)",
      );
    }
    let newRecords = 0;
    let repeatedSlug = false;
    for (const row of parsed.rows) {
      if (seen.has(row.externalId)) {
        repeatedSlug = true;
        const existing = rawById.get(row.externalId) ?? [];
        existing.push(row);
        rawById.set(row.externalId, existing);
        continue;
      }
      seen.add(row.externalId);
      rows.push(row);
      newRecords += 1;
    }
    emptyMarkerSeen = parsed.emptyMarker;
    const decision = crawlShouldStop({
      newRecords,
      repeatedSlug,
      emptyMarker: parsed.emptyMarker,
      pagesFetched,
      pageCap,
    });
    if (decision.stop) {
      stoppedBecause = decision.reason ?? "stopped";
      break;
    }
  }
  if (stoppedBecause === "" && pagesFetched >= pageCap) {
    stoppedBecause = `page cap reached (${pageCap} pages)`;
  }
  if (rows.length === 0 || (pagesFetched === 1 && rows.length === 0 && !emptyMarkerSeen)) {
    throw new SubnetParseError(
      "the SUBNet crawl parsed zero notices — refusing to treat a broken sweep as an empty board",
    );
  }

  // Detail pages: only for notices a previous complete run has never stored.
  const details = new Map<string, SubnetDetail>();
  let detailsSkipped = 0;
  for (const row of rows) {
    if (skipDetailFor.has(row.externalId)) {
      detailsSkipped += 1;
      continue;
    }
    const html = await fetchText(row.detailUrl);
    details.set(row.externalId, parseSubnetDetailPage(html));
  }

  const stats: SubnetCrawlStats = {
    requests: pagesFetched + details.size,
    pagesFetched,
    detailsFetched: details.size,
    detailsSkipped,
    stoppedBecause,
    durationMs: Date.now() - startedAt,
  };
  return { rows, details, collisions: [], stats };
}

/**
 * Index rows + detail pages → unclassified notices, in the source's own words.
 *
 * Precedence, stated once: the DETAIL page wins wherever both publish a value,
 * because it is the notice's own page and was fetched later than the list row. Both
 * original values are kept in `raw` (`indexClosingDate` / `detailClosingDate`, …) so
 * a reviewer can see the disagreement rather than trusting the merge.
 */
export function noticesFromCrawl(
  rows: readonly SubnetIndexRow[],
  details: ReadonlyMap<string, SubnetDetail>,
): { notices: SubcontractNotice[]; collisions: string[] } {
  const notices: SubcontractNotice[] = [];
  for (const row of rows) {
    const detail = details.get(row.externalId);
    const naics = row.naicsRaw;
    const splitFromIndex = splitNaics(naics);
    const naicsCode = detail?.naicsCode ?? splitFromIndex.code;
    const naicsTitle = detail?.naicsTitle ?? splitFromIndex.title;
    const naicsRaw =
      naicsCode && naicsTitle
        ? `${naicsCode}: ${naicsTitle}`
        : (naics ?? (naicsTitle ?? null));
    const closingRaw = detail?.closingRaw ?? row.closingRaw;
    const startRaw = detail?.performanceStartRaw ?? row.performanceStartRaw;
    const place = detail?.placeOfPerformance ?? row.placeRaw;
    notices.push({
      sourceKey: SUBNET_SOURCE.sourceKey,
      externalId: row.externalId,
      title: row.title,
      prime: row.prime,
      primeDivision: detail?.division ?? null,
      website: detail?.website ?? null,
      scope: detail?.description ?? row.description,
      summary: detail?.projectSummary ?? null,
      trades: listedScopes(naicsTitle),
      certsSolicited: detail?.certsSolicited ?? [],
      naics: naicsRaw,
      naicsCode,
      naicsTitle,
      placeOfPerformance: place,
      stateCode: stateCodeForPlace(place),
      closingDate: parseStateDay(closingRaw),
      performanceStartDate: parseStateDay(startRaw),
      contactName: detail?.contactName ?? row.contactName,
      contactEmail: detail?.contactEmail ?? row.contactEmail,
      contactPhone: detail?.contactPhone ?? row.contactPhone,
      sourceUrl: SUBNET_INDEX_URL,
      detailUrl: row.detailUrl,
      attachments: detail?.attachments ?? [],
      detailFetched: Boolean(detail),
      sourceUpdatedAt: null,
      raw: {
        index: { ...row },
        detail: detail ? { ...detail } : null,
        indexClosingDate: row.closingRaw,
        detailClosingDate: detail?.closingRaw ?? null,
        indexPlaceOfPerformance: row.placeRaw,
        detailPlaceOfPerformance: detail?.placeOfPerformance ?? null,
      },
    });
  }
  const { records, collisions } = dedupeNotices(notices);
  return { notices: records, collisions };
}
