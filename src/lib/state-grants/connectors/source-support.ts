/**
 * STATE-GRANTS CONNECTOR SUPPORT — the small, shared, PURE half of every
 * five-state-batch connector (owner P3 batch #1, 2026-09-19).
 *
 * WHY THIS MODULE EXISTS: each of the batch-1 sources is a different page shape
 * (a Drupal card list, a WordPress heading block, an Elementor data table, a
 * hand-built HTML table, and one more card list), but every one of them has to
 * answer the same questions the owner's honesty rules ask — is this a published
 * date or an estimate, does the source itself declare the program rolling, is
 * this link on the official host, and how do we keep the fetch fail-closed.
 * Those answers live here ONCE so five connectors cannot drift apart, and so the
 * unit tests can pin them at the source.
 *
 * PURE MODULE: no DB, no network at import time, no node builtins, no env reads.
 * `fetchStateGrantSource()` takes the fetch implementation as a parameter (the
 * same shape as the Virginia reference connector) so a test can drive it with a
 * fake and the default suite stays at ZERO network requests.
 *
 * HONESTY (CONVENTIONS.md §1–§2 — unchanged, and never loosened here):
 *   - a date we cannot parse EXACTLY is null, never guessed;
 *   - year-less dates ("Opens: Feb. 1.") are refused by `parseStateDay`, so a
 *     record carrying only those stays `unverified` — no invented year;
 *   - a cell that publishes SEVERAL DIFFERENT days is a multi-deadline cycle we
 *     cannot resolve to one closing date, so `singlePublishedDay()` returns null
 *     and the record is `unverified` rather than one of the dates being picked
 *     (see the doc on that function);
 *   - `declaresOngoing()` is the ONLY way a record becomes `rolling`, and it
 *     requires the source's own year-round / rolling / ongoing wording.
 */
import { parseStateDay } from "~/lib/state-grants/connector";

// ── Fetch (fail-closed, injected fetch impl) ────────────────────────────────

export const STATE_SOURCE_TIMEOUT_MS = 20_000;

/** A browser-like UA: these are public web pages, not APIs. */
export const STATE_SOURCE_USER_AGENT =
  "Mozilla/5.0 (compatible; ContraxGrantsBot/1.0; +https://www.contrax.company)";

/** Thrown for every fetch/parse failure. The sync runner aborts the state run. */
export class StateSourceError extends Error {
  readonly stage: "fetch" | "parse";
  constructor(stage: "fetch" | "parse", message: string) {
    super(message);
    this.name = "StateSourceError";
    this.stage = stage;
  }
}

export interface FetchSourceOptions {
  url: string;
  /** HTML marker the page must contain, or the run fails as a PARSE failure. */
  marker: string;
  /** Human source label used in error messages, e.g. "Arizona". */
  label: string;
  /** Bodies smaller than this are implausible — never parsed as a corpus. */
  minBytes?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one official listing page. Throws on timeout, a non-2xx response, an
 * implausibly small body, or a body that no longer contains the source's marker
 * — fail-closed: a failed run writes NOTHING, rather than a half-parsed corpus.
 */
export async function fetchStateGrantSource(options: FetchSourceOptions): Promise<string> {
  const { url, marker, label, minBytes = 1000, fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATE_SOURCE_TIMEOUT_MS);
  let status: number;
  let body: string;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": STATE_SOURCE_USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new StateSourceError(
      "fetch",
      aborted
        ? `${label} source timed out after ${STATE_SOURCE_TIMEOUT_MS}ms (${url})`
        : `${label} source request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (status < 200 || status >= 300) {
    throw new StateSourceError("fetch", `${label} source responded ${status} (${url})`);
  }
  if (!body || body.length < minBytes) {
    throw new StateSourceError(
      "parse",
      `${label} source returned an implausibly small body (${body?.length ?? 0} bytes)`,
    );
  }
  if (!body.includes(marker)) {
    throw new StateSourceError(
      "parse",
      `${label} source no longer looks like the expected listing (marker ${JSON.stringify(marker)} missing)`,
    );
  }
  return body;
}

// ── Text ────────────────────────────────────────────────────────────────────

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
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
    .replace(/[\u2018\u2019\u02bc\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2014|\u2013/g, "-");
}

/** Strips tags, decodes entities, collapses whitespace. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * The page's own text, normalised. The single entry point every date/word test
 * goes through, so curly quotes, entities and line-wrapped words are handled the
 * same way everywhere.
 */
export function normalizeText(html: string): string {
  return stripTags(html);
}

/** The slice of the document between a start marker and the first end marker. */
export function contentRegion(
  html: string,
  startMarker: string,
  endMarkers: readonly string[],
): string {
  const start = html.indexOf(startMarker);
  if (start === -1) return html;
  const rest = html.slice(start);
  let end = rest.length;
  for (const marker of endMarkers) {
    const idx = rest.indexOf(marker);
    if (idx !== -1 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}

/** First `href="…"` in a fragment, decoded; null when there is none. */
export function firstHref(html: string): string | null {
  const m = /<a\b[^>]*href\s*=\s*"([^"]+)"/i.exec(html);
  return m ? decodeEntities(m[1] ?? "").trim() : null;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const ISO_DAY_RE = /\b(\d{4}-\d{1,2}-\d{1,2})\b/g;
const NUMERIC_DAY_RE = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g;
const LONG_DAY_RE =
  /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;

/**
 * EVERY day the source published in a piece of text, in source order, parsed
 * exactly (`parseStateDay`) — year-less fragments simply do not match, which is
 * the point: "Opens: Feb. 1." yields nothing rather than a fabricated year.
 */
export function publishedDaysIn(raw: string): string[] {
  const text = stripTags(raw);
  const out: string[] = [];
  for (const re of [ISO_DAY_RE, NUMERIC_DAY_RE, LONG_DAY_RE]) {
    for (const m of text.matchAll(re)) {
      // `m[0]` in every pattern is the whole day ("2026-09-24", "09/24/2026",
      // "September 24, 2026"): the captured groups differ per pattern, so the
      // full match is the only thing safe to parse.
      const day = parseStateDay(m[0].replace(/(st|nd|rd|th)\b/i, ""));
      if (day !== null) out.push(day);
    }
  }
  return out;
}

/**
 * The ONE published closing day a cell resolves to, or null.
 *
 * Returns the day when the cell publishes exactly one distinct day (even if the
 * source repeats it for two windows — Hawaii's "Intent to Apply open August 1 -
 * October 30, 2026. Applications open September 1 - October 30, 2026" is one
 * closing day, published twice). Returns null when the cell publishes SEVERAL
 * DIFFERENT days — a quarterly/multi-deadline cycle where choosing one would be
 * us picking a deadline the source did not single out (Pennsylvania's
 * "Quarterly: -- 06/12/2026 -- 09/11/2026 …"). Those records stay `unverified`
 * with the source's own text kept in `raw`. Nothing is ever picked or averaged.
 */
export function singlePublishedDay(raw: string): string | null {
  const days = publishedDaysIn(raw);
  if (days.length === 0) return null;
  const unique = [...new Set(days)];
  return unique.length === 1 ? unique[0] : null;
}

/** True when the source's own words declare a program with no deadline. */
const ONGOING_RE =
  /\b(year[\s-]?round|rolling|ongoing|continuous|no (?:time|deadline)|no application deadline|accept(?:s|ing) applications (?:on a )?rolling|open until filled|always open|until (?:all )?funds (?:are|is) (?:awarded|exhausted))\b/i;

export function declaresOngoing(raw: string): boolean {
  return ONGOING_RE.test(stripTags(raw));
}

/** Words the source uses to declare a cycle finished, in its own tense. */
const CLOSED_WORDS_RE = /\b(closed|no longer (?:accepting|available)|has ended|is over)\b/i;

export function declaresClosed(raw: string): boolean {
  return CLOSED_WORDS_RE.test(stripTags(raw));
}

// ── Official links and ids ──────────────────────────────────────────────────

export interface OfficialUrlOptions {
  baseUrl: string;
  approvedHosts: readonly string[];
  /** Host to normalise an approved bare domain onto (e.g. azarts.gov → www). */
  canonicalHost?: string;
}

/**
 * The record's own page, pinned to the approved official hosts. A link off the
 * allowlist falls back to the LISTING page rather than sending a user (or a
 * future fetch) somewhere unverified — the Virginia reference rule.
 */
export function officialUrl(href: string | null, options: OfficialUrlOptions): string {
  const { baseUrl, approvedHosts, canonicalHost } = options;
  if (!href) return baseUrl;
  try {
    const url = new URL(href, baseUrl);
    if (!approvedHosts.includes(url.host)) return baseUrl;
    url.protocol = "https:";
    if (canonicalHost && url.host !== canonicalHost && approvedHosts.includes(canonicalHost)) {
      const bare = canonicalHost.replace(/^www\./, "");
      if (url.host === bare || url.host === canonicalHost) url.host = canonicalHost;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * The source's OWN identifier for a program: the slug of its page path. A
 * derivation from the source's published URL — never positional, and stable
 * across runs, which is what makes a re-run update a row instead of duplicating
 * it (CONVENTIONS.md §3).
 */
export function externalIdFromPath(url: string, stripPrefixes: readonly string[] = []): string | null {
  try {
    let path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    for (const prefix of stripPrefixes) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length);
        break;
      }
    }
    const slug = path
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
    return slug || null;
  } catch {
    return null;
  }
}

/** Deterministic de-duplication of derived ids (document order is stable). */
export function uniqueExternalIdFactory(): (base: string) => string {
  const taken = new Map<string, number>();
  return (base: string) => {
    const seen = taken.get(base) ?? 0;
    taken.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };
}
