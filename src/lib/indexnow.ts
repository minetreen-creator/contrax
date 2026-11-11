/**
 * IndexNow (owner 2026-11-07: "Yes" to telling Bing about new bid pages right after each sync).
 * Bids stay open for weeks, not months, so a page a crawler finds on its own schedule is often
 * found after the bid has closed. IndexNow (Bing, Yandex, Seznam, Naver; Google does not use it)
 * lets us say "these pages are new" once per sync. ChatGPT's web search leans on Bing's index,
 * and it already sends contractors to our bid pages.
 *
 * Only our own public page addresses are sent: no visitor data, nothing behind a login.
 * The key is public by design: Bing checks it at https://www.contrax.company/<key>.txt
 * (public/<key>.txt) to confirm we own the site.
 */
import { SITE_URL } from "./bid-seo";

export const INDEXNOW_KEY = "0136c9b0bcfa98dd8d94571bf3b11ac6";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** The protocol's limit per request. */
export const INDEXNOW_MAX_URLS = 10_000;

const HOST = new URL(SITE_URL).host;

/** Request bodies for these URLs: ours only, de-duplicated, at most 10,000 per body. PURE. */
export function indexNowBodies(urls: readonly string[]): { host: string; key: string; keyLocation: string; urlList: string[] }[] {
  const own = [...new Set(urls)].filter((u) => {
    try { return new URL(u).host === HOST && u.startsWith("https://"); } catch { return false; }
  });
  const bodies = [];
  for (let i = 0; i < own.length; i += INDEXNOW_MAX_URLS) {
    bodies.push({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`, urlList: own.slice(i, i + INDEXNOW_MAX_URLS) });
  }
  return bodies;
}

/** Every page address in a sitemap file. PURE. */
export function sitemapLocs(xml: string): string[] {
  return [...String(xml ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

/**
 * Which sitemaps a resubmission covers (owner away 2026-11-11; search traffic work). "pages" is the
 * state, trade, city and guide pages, whose bid lists change every day. "all" adds every open bid
 * page, for use after a change to the bid page itself.
 */
export const INDEXNOW_SITEMAPS = {
  pages: ["/sitemap.xml", "/sitemap-local.xml"],
  all: ["/sitemap.xml", "/sitemap-local.xml", "/sitemap-bids.xml"],
} as const;

export const indexNowDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

/** Submits the URLs; returns how many were accepted. Never throws: a failure is logged and the sync carries on. */
export async function submitIndexNow(urls: readonly string[]): Promise<{ sent: number; accepted: number; errors: string[] }> {
  let sent = 0, accepted = 0;
  const errors: string[] = [];
  for (const body of indexNowBodies(urls)) {
    sent += body.urlList.length;
    try {
      const res = await indexNowDeps.fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      // 200 OK and 202 Accepted both mean received; 202 means the key check is still pending.
      if (res.status === 200 || res.status === 202) accepted += body.urlList.length;
      else errors.push(`HTTP ${res.status}`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { sent, accepted, errors };
}
