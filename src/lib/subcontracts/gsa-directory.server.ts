/**
 * Contrax — SUBCONTRACTING preview: the GSA directory HTTP half (SERVER-ONLY).
 *
 * The mechanism (proven end-to-end by the spike, 2026-09-26 — no browser, no
 * dependency, ~300 ms over 4 small requests):
 *   1. the page HARDCODES the CSV; its theme JS aggregate does `Papa.parse("/media/170283")`
 *   2. `/media/170283` is a Drupal file handle that 302-redirects to the DATED file
 *      (`/system/files/subcontractor_directory_Jul-9-2025.csv`)
 *   3. the CSV is ~294 KB, one row per company, CRLF, no trailing newline
 *
 * THE GUARD, IN THIS ORDER (spike §6.4 — never a silent stale file):
 *   ① probe the pinned handle. A 3xx reveals the current dated URL; a 200 means the
 *      handle serves the file itself; anything else falls through to ②.
 *   ② re-resolve from the page's own bundles: fetch the page, scan its `/files/js/`
 *      aggregates for `Papa.parse("<path>")`, then probe the path that produced.
 *   ③ resolution fails ⇒ THROW. The run is recorded as failed and the previously stored
 *      rows keep being served — a fallback directory URL is never invented.
 *   ④ every result names which path resolved it (`pathResolvedFrom`), so a moved handle
 *      is visible in the run log instead of being indistinguishable from "no change".
 *
 * CHANGE DETECTION (spike §4). There is NO ETag. `Last-Modified` exists, and an
 * `If-Modified-Since` against the DATED URL returns `304` with 0 bytes — but the handle
 * itself ignores the header (always a 302), so the conditional request is made against
 * the dated file. The CDN RESTAMPS `Last-Modified` (the file name says Jul-9-2025 while
 * the header said 2026-05-11), so a header change does NOT prove a content change: the
 * bytes are hashed (sha256) and compared before anything is written.
 *
 * HOST DISCIPLINE. Every request must be to an allowlisted gsa.gov host, and a
 * `Location` that is not on the allowlist is refused. `fetch` + `node:crypto` only — no
 * CSV library, no headless browser, no new dependency.
 */
import { createHash } from "node:crypto";
import {
  GsaDirectoryError,
  gsaFileDateFromUrl,
  gsaFileNameFromUrl,
} from "~/lib/subcontracts/gsa-directory";

/** The one page this connector reads, and the only page it may cite. */
export const GSA_PAGE_URL = "https://www.gsa.gov/small-business/find-opportunities";
/** The pinned Drupal file handle in the page's own JS (spike §1.2). */
export const GSA_PINNED_CSV_PATH = "/media/170283";
/** Hosts this connector may request. Anything else is refused, not filtered. */
export const GSA_APPROVED_HOSTS = ["www.gsa.gov", "gsa.gov"] as const;
/** A descriptive UA, same discipline as the SUBNet crawler. */
export const GSA_USER_AGENT =
  "ContraxSubcontractingBot/1.0 (+https://www.contrax.company/subcontracts; weekly directory check)";
export const GSA_FETCH_TIMEOUT_MS = 20_000;
export const GSA_MAX_ATTEMPTS = 3;
/** The page's own bundle list is 5 aggregates; a cap keeps a reshape from walking the web. */
export const GSA_MAX_BUNDLES = 8;

export type GsaResolutionPath = "pin" | "bundle-discovery";

/** What a previous successful run left behind — the change-detection state. */
export interface GsaStoredFetchState {
  /** The `Last-Modified` of the dated file, used as `If-Modified-Since`. */
  lastModified: string | null;
  /** sha256 of the raw CSV bytes the last successful fetch downloaded. */
  contentSha256: string | null;
  /** The dated file URL the last successful fetch resolved. */
  fileUrl: string | null;
  lastNonNaicsDropped?: number | null;
}

export interface GsaDirectoryFetchResult {
  /** `not-modified` = 304, or the same sha256: nothing was written by the caller. */
  kind: "not-modified" | "downloaded";
  /** The dated file URL (from the redirect), or the probed URL when it served directly. */
  fileUrl: string;
  /** The source's own file name, from that URL — evidence for the run log. */
  fileName: string | null;
  /** `YYYY-MM-DD` from the dated file name, or null. NEVER from Last-Modified. */
  fileDate: string | null;
  /** The CSV `Last-Modified` (may be restamped by the CDN). */
  lastModified: string | null;
  /** sha256 of the raw bytes actually downloaded; null on a 304. */
  contentSha256: string | null;
  /** The CSV text; null on a 304. */
  text: string | null;
  /** How the CSV URL was resolved — a moved handle is visible in the run log. */
  pathResolvedFrom: GsaResolutionPath;
  /** True when the bytes were NOT fetched because the source answered 304. */
  notModified: boolean;
  /** True when the bytes were fetched but their sha256 equals the stored one. */
  contentUnchanged: boolean;
  /** HTTP requests this fetch spent. */
  requests: number;
}

export interface GsaDirectoryFetchOptions {
  fetchImpl?: typeof fetch;
  /** The change-detection state from the last successful run (null on a first run). */
  stored?: GsaStoredFetchState | null;
  pageUrl?: string;
  pinnedPath?: string;
  timeoutMs?: number;
  attempts?: number;
  userAgent?: string;
  maxBundles?: number;
}

function assertApprovedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GsaDirectoryError(`not a URL this connector may request: ${JSON.stringify(url)}`);
  }
  if (!(GSA_APPROVED_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new GsaDirectoryError(
      `host ${parsed.hostname} is not on the GSA allowlist — refusing to fetch it`,
    );
  }
  return parsed;
}

function absolute(from: string, location: string): string {
  return new URL(location, from).href;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The real HTTP reader. `redirect: "manual"` is deliberate: the probe must SEE the 302
 * and its `Location` (the dated URL) without downloading the 294 KB body twice.
 */
export function createGsaHttp(options: GsaDirectoryFetchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GSA_FETCH_TIMEOUT_MS;
  const attempts = options.attempts ?? GSA_MAX_ATTEMPTS;
  const userAgent = options.userAgent ?? GSA_USER_AGENT;
  let requests = 0;

  const request = async (
    url: string,
    accept: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> => {
    assertApprovedUrl(url);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      requests += 1;
      try {
        return await fetchImpl(url, {
          headers: {
            "user-agent": userAgent,
            accept,
            "accept-language": "en-US,en;q=0.9",
            ...extraHeaders,
          },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    throw new GsaDirectoryError(
      `GET ${url} failed after ${attempts} attempt(s): ${lastError?.message ?? "unknown error"}`,
    );
  };

  /** One probe: a 3xx yields its `Location`, a 200 means the handle IS the file. */
  const probe = async (
    url: string,
  ): Promise<{ followUrl: string | null; servesDirectly: boolean }> => {
    const response = await request(url, "*/*");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new GsaDirectoryError(`GET ${url} answered ${response.status} with no Location header`);
      }
      const target = absolute(url, location);
      assertApprovedUrl(target);
      return { followUrl: target, servesDirectly: false };
    }
    if (response.status === 200) return { followUrl: null, servesDirectly: true };
    throw new GsaDirectoryError(`GET ${url} answered HTTP ${response.status}`);
  };

  /** ② the page's own JS: the CSV path it hardcodes. */
  const resolveFromBundles = async (pageUrl: string): Promise<string> => {
    const page = await request(pageUrl, "text/html,application/xhtml+xml");
    if (!page.ok) {
      throw new GsaDirectoryError(`GET ${pageUrl} answered HTTP ${page.status}`);
    }
    const html = await page.text();
    if (html.trim() === "") throw new GsaDirectoryError(`GET ${pageUrl} returned an empty body`);
    const bundles = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
      .map((match) => match[1]!.replaceAll("&amp;", "&"))
      .filter((src) => src.includes("/files/js/"))
      .map((src) => absolute(pageUrl, src))
      .slice(0, options.maxBundles ?? GSA_MAX_BUNDLES);
    for (const bundle of bundles) {
      const response = await request(bundle, "text/javascript,application/javascript,*/*");
      if (!response.ok) continue;
      const body = await response.text();
      const match = /Papa\.parse\(\s*"([^"]+\.csv|\/media\/\d+)"\s*,/.exec(body);
      if (match) return match[1]!;
    }
    throw new GsaDirectoryError(
      `could not find the directory CSV path in the page's ${bundles.length} JS bundle(s) — refusing to guess a directory URL`,
    );
  };

  return async (fetchOptions: GsaDirectoryFetchOptions = {}): Promise<GsaDirectoryFetchResult> => {
    const pageUrl = fetchOptions.pageUrl ?? options.pageUrl ?? GSA_PAGE_URL;
    const pinnedPath = fetchOptions.pinnedPath ?? options.pinnedPath ?? GSA_PINNED_CSV_PATH;
    const stored = fetchOptions.stored ?? options.stored ?? null;
    const pinnedUrl = absolute(pageUrl, pinnedPath);

    let pathResolvedFrom: GsaResolutionPath = "pin";
    let resolved: string;
    try {
      const pinned = await probe(pinnedUrl);
      resolved = pinned.followUrl ?? pinnedUrl;
    } catch (pinnedError) {
      // ② the handle moved or broke: re-resolve from the page's own code, then THROW if
      // that fails too — the caller keeps serving what it already stored.
      pathResolvedFrom = "bundle-discovery";
      try {
        const discovered = await resolveFromBundles(pageUrl);
        const discoveredUrl = absolute(pageUrl, discovered);
        const probed = await probe(discoveredUrl);
        resolved = probed.followUrl ?? discoveredUrl;
      } catch (discoveryError) {
        throw new GsaDirectoryError(
          `could not resolve the GSA directory CSV: the pinned handle ${pinnedUrl} failed (${
            pinnedError instanceof Error ? pinnedError.message : String(pinnedError)
          }) and re-resolving from the page's own bundles failed (${
            discoveryError instanceof Error ? discoveryError.message : String(discoveryError)
          }) — refusing to guess a URL; the previously stored rows keep being served`,
        );
      }
    }

    // The conditional request goes to the DATED file (the handle ignores the header).
    const headers: Record<string, string> = {};
    if (stored?.lastModified && stored.fileUrl && stored.fileUrl === resolved) {
      headers["if-modified-since"] = stored.lastModified;
    }
    const response = await request(resolved, "text/csv,text/plain,*/*", headers);
    if (response.status === 304) {
      return {
        kind: "not-modified",
        fileUrl: resolved,
        fileName: gsaFileNameFromUrl(resolved),
        fileDate: gsaFileDateFromUrl(resolved),
        lastModified: stored?.lastModified ?? null,
        contentSha256: stored?.contentSha256 ?? null,
        text: null,
        pathResolvedFrom,
        notModified: true,
        contentUnchanged: true,
        requests,
      };
    }
    if (!response.ok) {
      throw new GsaDirectoryError(`GET ${resolved} answered HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.trim() === "") {
      throw new GsaDirectoryError(`GET ${resolved} returned an empty body`);
    }
    const contentSha256 = sha256(text);
    const contentUnchanged = stored?.contentSha256 === contentSha256;
    return {
      kind: contentUnchanged ? "not-modified" : "downloaded",
      fileUrl: resolved,
      fileName: gsaFileNameFromUrl(resolved),
      fileDate: gsaFileDateFromUrl(resolved),
      lastModified: response.headers.get("last-modified"),
      contentSha256,
      text,
      pathResolvedFrom,
      notModified: false,
      contentUnchanged,
      requests,
    };
  };
}

/**
 * The default fetcher: one resolution pass with no previous state. Exported so the sync
 * can be driven with an injected fetcher in tests and with this one in production.
 */
export const fetchGsaDirectory = createGsaHttp();
