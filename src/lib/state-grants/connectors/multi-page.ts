/**
 * STATE-GRANTS MULTI-PAGE FETCH — the second shared fetch pattern (owner
 * nationwide workstream, 2026-09-19; spec §B).
 *
 * WHY THIS MODULE EXISTS: nine of the twelve jurisdictions in the current
 * tranche publish a PROGRAM CATALOGUE on their index page and the dates that
 * matter on each program's own CHILD page (Class B in the build spec). The
 * single-page `fetchStateGrantSource()` cannot express that: one fetch, one
 * body. Hand-rolling the fan-out in each connector would let nine connectors
 * drift apart on the two things that must never drift — what happens when a
 * child fetch FAILS, and which page a record's dates came from.
 *
 * THE CONTRACT (every clause is pinned by a test):
 *   1. The connector still returns `TRaw = string` — the shared live harness
 *      does `stripTags(live.html)`, so an object payload would throw. Pages are
 *      therefore CONCATENATED into one string, each page introduced by an
 *      explicit delimiter line `\n<!--SOURCE-PAGE: <url>-->\n`.
 *   2. `splitSourcePages()` reverses that exactly, so `parse()` can attribute
 *      every record to the page that published it — and can never inherit a
 *      date from a sibling or from the index (the District of Columbia NO-GO
 *      cause: positional date ownership).
 *   3. Order is the index page first, then the child URLs in the order the INDEX
 *      published them, de-duplicated. Deterministic: the same page yields the
 *      same concatenation, byte for byte.
 *   4. Fan-out is BOUNDED (`maxChildren`, default 24). A catalogue with more
 *      child links than the cap fails loudly rather than silently serving a
 *      truncated corpus.
 *   5. ANY child fetch failure (timeout, non-2xx, too small, off-allowlist
 *      redirect, missing marker) throws `StateSourceError("fetch")`. A partial
 *      corpus is never parsed: fail-closed, exactly like the single page.
 *
 * PURE MODULE: no DB, no network at import time; `fetchStateGrantPages()` takes
 * the fetch implementation as a parameter, so the default suite stays at ZERO
 * network requests.
 */
import { StateSourceError, fetchStateGrantSource } from "~/lib/state-grants/connectors/source-support";

/** The delimiter that introduces one fetched page inside the payload. */
export const SOURCE_PAGE_PREFIX = "<!--SOURCE-PAGE: ";
const SOURCE_PAGE_DELIMITER_RE = /\n?<!--SOURCE-PAGE: (\S+)-->\n?/g;

/** The delimiter line for one page URL (exported so fixtures can match exactly). */
export function sourcePageDelimiter(url: string): string {
  return `\n${SOURCE_PAGE_PREFIX}${url}-->\n`;
}

/** One page inside a concatenated payload: the URL it was fetched from + its body. */
export interface SourcePage {
  url: string;
  html: string;
}

/** Concatenates fetched pages into the ONE string a connector's parse() sees. */
export function joinSourcePages(
  indexUrl: string,
  indexHtml: string,
  children: readonly SourcePage[] = [],
): string {
  let out = `${sourcePageDelimiter(indexUrl)}${indexHtml}`;
  for (const child of children) out += `${sourcePageDelimiter(child.url)}${child.html}`;
  return out;
}

/**
 * Splits a concatenated payload back into its pages, in fetch order. A payload
 * with no delimiter at all is returned as ONE page with an empty URL, so a
 * connector that still receives a raw single-page body (an older fixture, a
 * direct call) keeps working and simply has no sibling pages.
 */
export function splitSourcePages(raw: string): SourcePage[] {
  if (typeof raw !== "string") return [];
  const pages: SourcePage[] = [];
  let lastUrl: string | null = null;
  let lastEnd = -1;
  for (const m of raw.matchAll(new RegExp(SOURCE_PAGE_DELIMITER_RE.source, "g"))) {
    const at = m.index ?? 0;
    if (lastUrl !== null) pages.push({ url: lastUrl, html: raw.slice(lastEnd, at) });
    else if (at > 0) pages.push({ url: "", html: raw.slice(0, at) });
    lastUrl = m[1] ?? "";
    lastEnd = at + m[0].length;
  }
  if (lastUrl !== null) pages.push({ url: lastUrl, html: raw.slice(lastEnd) });
  else pages.push({ url: "", html: raw });
  return pages;
}

export interface MultiPageFetchOptions {
  /** The catalogue/listing page. */
  indexUrl: string;
  /** Content marker the index must contain (fail-closed). */
  marker: string;
  /** Human source label for error messages, e.g. "Montana". */
  label: string;
  /** Hosts a FINAL response URL (index or child) may use. */
  approvedHosts: readonly string[];
  /** Index bodies smaller than this are implausible. */
  minBytes?: number;
  /** Child bodies smaller than this are implausible (default 400). */
  childMinBytes?: number;
  fetchImpl?: typeof fetch;
  /**
   * The child URLs THIS index publishes, in the index's own order. Receives the
   * index HTML so a connector can scope the links it trusts (e.g. only cards in
   * the listing region, only one host, only a known path prefix).
   */
  childUrls: (indexHtml: string) => string[];
  /** Hard cap on fetched children (default 24); more than this fails loudly. */
  maxChildren?: number;
  /** Optional per-child content marker. */
  childMarker?: string;
}

/**
 * Fetches the index plus every child the index publishes, and returns them as
 * ONE delimited string. Throws `StateSourceError` on any failure — including a
 * child that fails while others succeeded (no partial corpus, ever).
 */
export async function fetchStateGrantPages(options: MultiPageFetchOptions): Promise<string> {
  const {
    indexUrl,
    marker,
    label,
    approvedHosts,
    minBytes = 1000,
    childMinBytes = 400,
    fetchImpl = fetch,
    childUrls,
    maxChildren = 24,
    childMarker,
  } = options;

  const indexHtml = await fetchStateGrantSource({
    url: indexUrl,
    marker,
    label: `${label} (listing)`,
    minBytes,
    fetchImpl,
    approvedHosts,
  });

  const urls = [...new Set(childUrls(indexHtml).filter((u) => typeof u === "string" && u.length > 0))];
  if (urls.length > maxChildren) {
    throw new StateSourceError(
      "fetch",
      `${label} listing publishes ${urls.length} child pages, more than the ${maxChildren} this connector bounds its fan-out to — refusing to parse a truncated catalogue`,
    );
  }

  const children: SourcePage[] = [];
  for (const url of urls) {
    // Sequential and in index order on purpose: deterministic, and gentle on a
    // state server that is publishing a public listing for free.
    const html = await fetchStateGrantSource({
      url,
      marker: childMarker ?? "",
      label: `${label} (child ${url})`,
      minBytes: childMinBytes,
      fetchImpl,
      approvedHosts,
    });
    children.push({ url, html });
  }
  return joinSourcePages(indexUrl, indexHtml, children);
}
