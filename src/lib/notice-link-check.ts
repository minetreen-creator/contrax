/**
 * notice-link-check.ts — "does this original-notice URL actually RESOLVE to a
 * real notice page?" (owner acceptance 2026-09-18: "original notice opens
 * correctly").
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * QA + the lead verified in production that the homepage example's
 * "Open original notice ↗" link for bid 134946
 * (https://a856-cityrecord.nyc.gov/20260902028) redirects to the publisher's
 * own error page:
 *
 *   GET /20260902028  →  302  →  /Error/Error404?aspxerrorpath=/20260902028
 *
 * and — this is the trap — that final error page answers **HTTP 200**, so a
 * status-code-only check would call the dead link healthy. A homepage example
 * whose notice link 404s fails the owner's acceptance, so the example SELECTION
 * must treat a source_url that does not resolve as ineligible and fall back to
 * the next eligible opportunity.
 *
 * ── DESIGN (deliberately tiny) ────────────────────────────────────────────
 *   - ONE bounded HTTP GET per URL (never a document download): the response
 *     body is read up to NOTICE_LINK_MAX_BYTES and then cancelled — enough to
 *     sniff an "error page" body, never enough to pull a solicitation PDF.
 *   - Redirects ARE followed (redirect: "follow"), because a dead link is
 *     usually a redirect to the publisher's error page (as above).
 *   - A hard timeout (NOTICE_LINK_TIMEOUT_MS, env-overridable) bounds every
 *     probe; a probe that cannot finish inside the cap is `unknown`, NEVER
 *     `dead` (a slow network must not hide a notice that actually works).
 *   - Three outcomes, so the caller can be honest about uncertainty:
 *       live    — resolved to a real page (2xx/3xx final, no error markers);
 *       dead    — 4xx/5xx destination, or an obvious publisher error page
 *                 (error path in the final URL, or an error marker in the
 *                 title/body of an HTML response);
 *       unknown — timeout, network error, invalid/unsupported URL shape, or a
 *                 deliberately blocked response (401/403/429) that we cannot
 *                 read as proof of death.
 *   - RESULTS ARE CACHED per URL in-process: live/dead for
 *     NOTICE_LINK_CACHE_TTL_MS (~12 h), `unknown` for the much shorter
 *     NOTICE_LINK_UNKNOWN_TTL_MS (~5 min, so a transient failure is retried and
 *     never remembered as truth). Concurrent callers for the same URL share a
 *     single in-flight probe, so an ordinary homepage request never re-fetches
 *     a URL more than once per TTL.
 *
 * The module is dependency-injectable (`fetchImpl`, `now`) so every rule above
 * is unit tested without touching the network — see
 * tests/example-brief-notice-link.test.ts.
 */

export type NoticeLinkStatus = "live" | "dead" | "unknown";

export interface NoticeLinkProbe {
  status: NoticeLinkStatus;
  /** Short machine token for logs (never shown to a user). */
  reason: string;
  /** Final URL after redirects (null when no response was produced). */
  finalUrl: string | null;
  httpStatus: number | null;
}

/** Hard cap on one probe — ~4–5 s per the owner's bound. */
export const NOTICE_LINK_TIMEOUT_MS = 4_500;
export const NOTICE_LINK_TIMEOUT_ENV = "EXAMPLE_BRIEF_LINK_CHECK_TIMEOUT_MS";
/** How much of an HTML body may be read while sniffing for an error page. */
export const NOTICE_LINK_MAX_BYTES = 16_384;
/** Cache TTL for a PROVEN result (live or dead). */
export const NOTICE_LINK_TTL_MS = 12 * 60 * 60 * 1000;
export const NOTICE_LINK_TTL_ENV = "EXAMPLE_BRIEF_LINK_CHECK_TTL_MS";
/** Cache TTL for an UNPROVEN result (timeout / transient failure). */
export const NOTICE_LINK_UNKNOWN_TTL_MS = 5 * 60 * 1000;

/** Destination statuses that are honest proof of a dead notice page. */
const DEAD_HTTP_STATUS = new Set([400, 404, 405, 410, 451, 500, 501, 502, 503, 504, 505]);
/** Statuses where the publisher is (probably) refusing a bot: cannot conclude. */
const BLOCKED_HTTP_STATUS = new Set([401, 403, 406, 429]);
/** Final-URL shapes that are an obvious publisher error page. */
const ERROR_PATH_RE =
  /(\/error(\/|$)|error404|\/e404|errorpage|aspxerrorpath|\/404(\/|$)|page-?not-?found|\/notfound)/i;
/** <title> shapes that are an obvious publisher error page. */
const ERROR_TITLE_RE = /<title[^>]*>[^<]*(404|not found|error|no longer available|unavailable)[^<]*<\/title>/i;
/** Visible-body markers of an obvious publisher error page. */
const ERROR_BODY_RE =
  /(aspxerrorpath|error\s*404|page not found|page cannot be found|the page you (are looking for|requested)|this page (could not be found|does not exist)|requested url was not found|no longer available)/i;

/** Parse a positive integer env override with clamping; invalid ⇒ fallback. */
export function parseEnvInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env?.[name];
  if (typeof raw !== "string") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Per-probe timeout (env: EXAMPLE_BRIEF_LINK_CHECK_TIMEOUT_MS, ~4–5 s cap). */
export function noticeLinkTimeoutMs(env: Record<string, string | undefined>): number {
  return parseEnvInt(env, NOTICE_LINK_TIMEOUT_ENV, NOTICE_LINK_TIMEOUT_MS, 250, 10_000);
}

/** Proven-result cache TTL (env: EXAMPLE_BRIEF_LINK_CHECK_TTL_MS, ~12 h). */
export function noticeLinkTtlMs(env: Record<string, string | undefined>): number {
  return parseEnvInt(env, NOTICE_LINK_TTL_ENV, NOTICE_LINK_TTL_MS, 60_000, 7 * 24 * 60 * 60 * 1000);
}

/** Does an HTML page look like the publisher's own error page? */
export function looksLikeErrorPage(finalUrl: string, html: string): boolean {
  if (ERROR_PATH_RE.test(finalUrl)) return true;
  if (ERROR_TITLE_RE.test(html)) return true;
  return ERROR_BODY_RE.test(html);
}

/**
 * ONE bounded probe of a notice URL. Never throws — every failure mode maps to a
 * `NoticeLinkStatus` so the caller can decide, and never fabricates "live".
 */
export async function probeNoticeLink(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<NoticeLinkProbe> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? NOTICE_LINK_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "dead", reason: "invalid_url", finalUrl: null, httpStatus: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { status: "dead", reason: "unsupported_protocol", finalUrl: null, httpStatus: null };
  }
  if (typeof fetchImpl !== "function") {
    return { status: "unknown", reason: "no_fetch", finalUrl: null, httpStatus: null };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // A browser-ish Accept matters: several procurement portals (SAM.gov
        // included) reject or mis-shape responses for a bare fetch UA.
        "user-agent":
          "Mozilla/5.0 (compatible; ContraxNoticeLinkCheck/1.0; +https://www.contrax.company)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    const aborted = name === "TimeoutError" || name === "AbortError";
    return {
      status: "unknown",
      reason: aborted ? "timeout" : "network_error",
      finalUrl: null,
      httpStatus: null,
    };
  }

  const finalUrl = res.url || url;
  const status = res.status;

  if (DEAD_HTTP_STATUS.has(status)) {
    return { status: "dead", reason: `http_${status}`, finalUrl, httpStatus: status };
  }
  if (BLOCKED_HTTP_STATUS.has(status)) {
    return { status: "unknown", reason: `http_${status}_blocked`, finalUrl, httpStatus: status };
  }
  if (ERROR_PATH_RE.test(finalUrl)) {
    // The 200-with-an-error-page trap (NYC City Record): the *destination* is
    // the proof, no body read needed.
    return { status: "dead", reason: "error_page_redirect", finalUrl, httpStatus: status };
  }

  const contentType = (res.headers?.get?.("content-type") ?? "").toLowerCase();
  const textish =
    contentType.includes("html") || contentType.includes("text/") || contentType === "";
  if (textish) {
    const body = await readCappedText(res, NOTICE_LINK_MAX_BYTES);
    if (body !== null && ERROR_TITLE_RE.test(body)) {
      return { status: "dead", reason: "error_page_title", finalUrl, httpStatus: status };
    }
    if (body !== null && ERROR_BODY_RE.test(body)) {
      return { status: "dead", reason: "error_page_body", finalUrl, httpStatus: status };
    }
    if (body === null) {
      // The body stream failed/timed out mid-read: the page answered, but we
      // could not read it to a verdict. Honest answer: unknown.
      return { status: "unknown", reason: "body_read_failed", finalUrl, httpStatus: status };
    }
  }

  return { status: "live", reason: `http_${status}`, finalUrl, httpStatus: status };
}

/**
 * Read at most `maxBytes` of a response body as text, then cancel the stream —
 * "HEAD-ish or limited GET with tiny size cap", never a document download.
 * Returns null when the stream could not be read (timeout / abort).
 */
async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        const room = maxBytes - total;
        const slice = value.length > room ? value.subarray(0, room) : value;
        chunks.push(slice);
        total += slice.length;
        if (total >= maxBytes) break;
      }
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
    if (at >= total) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process cache (per server instance)
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  probe: NoticeLinkProbe;
  at: number;
}
const CACHE_MAX_ENTRIES = 256;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<NoticeLinkProbe>>();

function ttlFor(probe: NoticeLinkProbe, env: Record<string, string | undefined>): number {
  return probe.status === "unknown" ? NOTICE_LINK_UNKNOWN_TTL_MS : noticeLinkTtlMs(env);
}

/**
 * Cached notice-link check. `live`/`dead` are remembered ~12 h (a dead link is
 * not re-probed on every homepage request); `unknown` only ~5 min so a transient
 * timeout is retried. Concurrent calls for the same URL share one probe.
 */
export async function checkNoticeLink(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<NoticeLinkProbe> {
  const now = opts.now ?? Date.now;
  const env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
  const timeoutMs = opts.timeoutMs ?? noticeLinkTimeoutMs(env);

  const cached = cache.get(url);
  if (cached && now() - cached.at < ttlFor(cached.probe, env)) return cached.probe;

  const pending = inflight.get(url);
  if (pending) {
    const probe = await pending;
    // A shared in-flight probe ran with someone else's cap; re-read the cache
    // only if it landed as a proven result, otherwise report it as-is.
    return probe;
  }

  const promise = probeNoticeLink(url, { fetchImpl: opts.fetchImpl, timeoutMs })
    .catch((): NoticeLinkProbe => ({
      status: "unknown",
      reason: "probe_failed",
      finalUrl: null,
      httpStatus: null,
    }))
    .then((probe) => {
      cache.set(url, { probe, at: now() });
      if (cache.size > CACHE_MAX_ENTRIES) {
        for (const [key, entry] of cache) {
          if (cache.size <= CACHE_MAX_ENTRIES) break;
          if (now() - entry.at >= ttlFor(entry.probe, env)) cache.delete(key);
        }
        // Still above the cap (everything fresh)? Drop oldest-inserted keys.
        for (const key of cache.keys()) {
          if (cache.size <= CACHE_MAX_ENTRIES) break;
          cache.delete(key);
        }
      }
      return probe;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

/** Test hooks — never used by production code. */
export function __resetNoticeLinkCache(): void {
  cache.clear();
  inflight.clear();
}
export function __noticeLinkCacheSize(): number {
  return cache.size;
}
