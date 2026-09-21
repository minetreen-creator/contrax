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

/**
 * OPT-IN PUBLIC-SESSION HANDSHAKE — the ONE portal in this workstream whose
 * listing is served only inside a session (New York's SFS Vendor Portal).
 *
 * WHY THIS IS ALLOWED AT ALL (owner decision, 2026-09-19, verbatim):
 * "Allow normal, temporary public-session cookies only—no login, CAPTCHA bypass,
 * or persistent credential storage. Fail closed if the public session cannot be
 * established." New York's own Grants Management page says of this portal:
 * "Anyone can access the Grant Opportunity Portal. A username and password are
 * not necessary to view anticipated and available grant opportunities."
 *
 * WHAT IT IS: a GET of the portal's own PUBLIC guest/session page, and then the
 * listing GET carrying — in memory, for this run only — the cookies THAT page's
 * own response told us to send. It is exactly what a browser does before it can
 * read the listing, and nothing more.
 *
 * WHAT IT IS NOT (each bar is structural, not a comment):
 *   - NO credentials are sent: no POST, no form fields, no Authorization header
 *     (we only ever set `accept`, `user-agent` and, when a handshake ran,
 *     `cookie`), so no login can take place even if the page later asks;
 *   - NO CAPTCHA or access control is solved or bypassed: a handshake that is not
 *     completed by an ordinary 2xx response FAILS CLOSED below;
 *   - NOTHING IS PERSISTED: the jar is a local Map inside the call. No file, no
 *     env, no module state, no database, and the values are never logged;
 *   - NO dormant capability: the option is read only when a connector declares
 *     it, so every other state's single fail-closed GET is byte-identical.
 */
export interface PublicSessionOptions {
  /** The portal's own public session page. GET only — never a login form post. */
  sessionUrl: string;
  /** Marker the session page must carry (fail-closed proof we hit the portal). */
  sessionMarker: string;
  /** A session page smaller than this is implausible. */
  sessionMinBytes?: number;
  /**
   * Cookie name(s) that response must set, or the handshake fails closed. The
   * caller names the ONE session cookie the portal's public pages depend on.
   */
  requiredCookies: readonly string[];
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
  /**
   * OPT-IN public-session handshake (see `PublicSessionOptions`). Absent for
   * every state but New York, which is what keeps this change additive.
   */
  publicSession?: PublicSessionOptions;
  /**
   * Hosts the FINAL response URL may use once redirects have been followed (the
   * connector's own approved-host allowlist).
   *
   * WHY (QA flag #5 on the batch-1 checklist): the gate used to check only the
   * status, the body size and the content marker, so a listing fetch that
   * redirected to a vendor portal or a parked domain could still be parsed as if
   * it were the agency's own page — the record-level URLs are pinned, but the
   * PAGE we read was not. A connector that passes this list now fails the fetch
   * stage when the final host is not one of its official hosts. Optional and
   * additive: a connector that does not pass it keeps its previous behaviour.
   */
  approvedHosts?: readonly string[];
}

/**
 * Fetches one official listing page. Throws on timeout, a non-2xx response, an
 * implausibly small body, a final URL that left the approved hosts, or a body
 * that no longer contains the source's marker — fail-closed: a failed run writes
 * NOTHING, rather than a half-parsed corpus.
 */
async function requestOnce(options: {
  url: string;
  label: string;
  fetchImpl: typeof fetch;
  /** Present only after a completed public handshake — never user input. */
  cookie?: string;
}): Promise<{ status: number; body: string; finalUrl: string; res: Response }> {
  const { url, label, fetchImpl, cookie } = options;
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml",
    "user-agent": STATE_SOURCE_USER_AGENT,
  };
  // The ONLY header a handshake ever adds. No cookie is user- or
  // credential-derived: it is what the portal's own public page just set.
  if (cookie) headers.cookie = cookie;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATE_SOURCE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    const status = res.status;
    const finalUrl = typeof res.url === "string" ? res.url : "";
    const body = await res.text();
    return { status, body, finalUrl, res };
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
}

/** The four fail-closed checks every fetched page must pass, unchanged. */
function assertUsablePage(
  page: { status: number; body: string; finalUrl: string },
  options: {
    url: string;
    label: string;
    marker: string;
    minBytes: number;
    approvedHosts?: readonly string[];
  },
): void {
  const { url, label, marker, minBytes, approvedHosts } = options;
  const { status, body, finalUrl } = page;
  if (status < 200 || status >= 300) {
    throw new StateSourceError("fetch", `${label} source responded ${status} (${url})`);
  }
  if (approvedHosts && approvedHosts.length > 0 && finalUrl.length > 0) {
    let finalHost: string | null = null;
    try {
      finalHost = new URL(finalUrl).host;
    } catch {
      finalHost = null;
    }
    if (finalHost === null || !approvedHosts.includes(finalHost)) {
      throw new StateSourceError(
        "fetch",
        `${label} source redirected off the approved hosts (${finalUrl}) — refusing to parse a listing served by a host that is not on the allowlist`,
      );
    }
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
}

/** Set-Cookie values of one response, however the runtime exposes them. */
function readSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    try {
      const all = headers.getSetCookie();
      if (Array.isArray(all) && all.length > 0) return all;
    } catch {
      // Fall through to the single-header path below.
    }
  }
  const combined = res.headers.get("set-cookie");
  if (!combined) return [];
  // Split only at a comma that is followed by `name=`, so an Expires date
  // ("…, 01-Jan-1970 …") is never mistaken for a cookie boundary.
  return combined.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/);
}

/**
 * The cookie header for THIS request only, built from the cookies the portal's
 * own session page set. Never returned, never logged, never stored anywhere.
 */
function sessionCookieHeader(
  res: Response,
  options: PublicSessionOptions,
  label: string,
): string {
  const jar = new Map<string, string>();
  for (const raw of readSetCookies(res)) {
    const pair = (raw.split(";")[0] ?? "").trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name.length === 0) continue;
    // A server clearing a cookie (empty value) is not a session we can use.
    if (value.length === 0) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
  for (const required of options.requiredCookies) {
    if (!jar.has(required)) {
      throw new StateSourceError(
        "fetch",
        `${label} public session did not set the ${required} cookie — refusing to read a listing served outside a public session (fail closed)`,
      );
    }
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function fetchStateGrantSource(options: FetchSourceOptions): Promise<string> {
  const { url, marker, label, minBytes = 1000, fetchImpl = fetch, approvedHosts, publicSession } =
    options;
  // 0. OPT-IN public-session handshake. Absent for every state but New York, so
  //    every other source's single fail-closed GET is byte-identical to before.
  let cookie: string | undefined;
  if (publicSession) {
    const sessionLabel = `${label} public session page`;
    const sessionPage = await requestOnce({
      url: publicSession.sessionUrl,
      label: sessionLabel,
      fetchImpl,
    });
    assertUsablePage(sessionPage, {
      url: publicSession.sessionUrl,
      label: sessionLabel,
      marker: publicSession.sessionMarker,
      minBytes: publicSession.sessionMinBytes ?? 1000,
      approvedHosts,
    });
    cookie = sessionCookieHeader(sessionPage.res, publicSession, label);
  }
  const page = await requestOnce({ url, label, fetchImpl, cookie });
  assertUsablePage(page, { url, label, marker, minBytes, approvedHosts });
  return page.body;
}

// ── Text ────────────────────────────────────────────────────────────────────

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // Named dash entities (the California Grants Portal publishes its award
    // ranges as "$100,000 &ndash; $600,000"): decoded like the numeric forms
    // below, so a record never carries raw markup in a displayed field.
    .replace(/&ndash;|&mdash;/g, "-")
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

/**
 * The ordered ends of a date RANGE the source published in ONE cell/value
 * ("08/25/2026 - 03/25/2027", "04/03/2025 - No end date").
 *
 * WHY THIS EXISTS (QA flag #4 on the batch-1 checklist): `singlePublishedDay()`
 * refuses a cell holding several distinct days, which is RIGHT for an ambiguous
 * multi-deadline cell — but a source that publishes its application window as an
 * ORDERED range ("Application Period: A - B", "Application Date Range: A - B")
 * has told us exactly which end is the opening day and which is the closing day.
 * Reading them in source order is not an inference: it is the source's own cell
 * semantics, which is why this returns the two ends SEPARATELY and never picks,
 * averages or interpolates anything.
 *
 * HONESTY RULES (each one is pinned by a test):
 *   - exactly two ends, else both are null (a single day, or three-part text, is
 *     not a range we can read — the record stays honestly undated);
 *   - each end must parse as a single exact day (`singlePublishedDay`), so a
 *     year-less or multi-day end yields null rather than a guessed date;
 *   - the source's own "no end date" wording (and only that) is reported as
 *     `openEnded: true` — the connector decides what to do with it (this module
 *     never turns it into a status);
 *   - the RAW ends are returned verbatim for `raw`, so a reviewer sees the text.
 */
export interface PublishedRange {
  startDay: string | null;
  endDay: string | null;
  /** True only when the SECOND end is the source's own "no end date" wording. */
  openEnded: boolean;
  /** The source's own two ends, verbatim (empty when the cell is not a range). */
  parts: string[];
}

/** The source's own wording that declares an application window has no end. */
const NO_END_DATE_RE = /^(no end date|no closing date|no deadline|open[- ]ended|no end)$/i;

export function publishedRangeEnds(raw: string): PublishedRange {
  const text = stripTags(raw);
  const parts = text
    .split(/\s+[-\u2013\u2014]\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length !== 2) return { startDay: null, endDay: null, openEnded: false, parts };
  const [start, end] = parts as [string, string];
  const openEnded = NO_END_DATE_RE.test(end);
  return {
    startDay: singlePublishedDay(start),
    endDay: openEnded ? null : singlePublishedDay(end),
    openEnded,
    parts,
  };
}

/**
 * The award amounts the source published, read off its own wording.
 * One amount is the ceiling the source states ("Up to $5,000" ⇒ max only);
 * two become the range it publishes ("$15000 - $75000" ⇒ min + max).
 * No amount, or wording that states none, ⇒ both null (never invented).
 */
export function publishedAmountRange(raw: string): { min: number | null; max: number | null } {
  const amounts = [...stripTags(raw).matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Number((m[1] ?? "").replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
  if (amounts.length === 0) return { min: null, max: null };
  return amounts.length === 1
    ? { min: null, max: amounts[0]! }
    : { min: Math.min(...amounts), max: Math.max(...amounts) };
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
