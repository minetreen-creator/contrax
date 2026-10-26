/**
 * Scraper tracker (owner 2026-10-26: a "Harare, HA" visitor sat on /radar —
 * "probably a scraper" → "track them"). The owner console's Track button
 * pins a visitor to `tracked_visitors`; the trail panel shows what that
 * visitor actually did and which bot signals fired.
 *
 * Pure, client-safe helpers live here. Every signal reads a tracked
 * page_views / visitors / radar_search_log row; nothing is guessed. Signals
 * flag, they never block: a flagged visitor still gets the site.
 */

export interface TrailInput {
  /** visitors.country (two-letter, from the IP geo). */
  country: string | null;
  userAgent: string | null;
  /** Page views in the last hour, oldest first (ms timestamps). */
  hitTimesHour: number[];
  /** Distinct /bid/<id> pages in the last hour. */
  bidPagesHour: number;
  /** Radar searches in the last hour. */
  searchesHour: number;
  signedIn: boolean;
  /** Other visitor ids seen on the same IP in the last 24 hours. */
  sameIpVisitors: number;
}

export interface ScraperSignal {
  key: "abroad" | "automation" | "fast" | "bid-sweep" | "search-burst" | "ip-fanout";
  label: string;
}

const AUTOMATION_UA = [
  "headless",
  "python",
  "curl",
  "wget",
  "scrapy",
  "puppeteer",
  "playwright",
  "selenium",
  "phantomjs",
  "httpclient",
  "go-http",
  "node-fetch",
  "axios",
  "okhttp",
  "java/",
  "libwww",
  "bot",
  "crawler",
  "spider",
];

/** The user-agent fragment that looks automated, or null. */
export function automationMarker(userAgent: string | null | undefined): string | null {
  const ua = String(userAgent ?? "").toLowerCase();
  if (!ua) return "no user agent";
  return AUTOMATION_UA.find((m) => ua.includes(m)) ?? null;
}

/** Median seconds between consecutive hits, or null with fewer than 3 hits. */
export function medianGapSeconds(times: number[]): number | null {
  if (times.length < 3) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]) / 1000).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Which bot signals fire for one visitor. Signed-in visitors only get the
 * automation signal: a paying customer abroad or clicking fast is a customer.
 */
export function scraperSignals(t: TrailInput): ScraperSignal[] {
  const out: ScraperSignal[] = [];
  const marker = automationMarker(t.userAgent);
  if (marker) out.push({ key: "automation", label: `Automated browser (${marker})` });
  if (t.signedIn) return out;
  const country = String(t.country ?? "").trim().toUpperCase();
  if (country && country !== "US") out.push({ key: "abroad", label: `Outside the US (${country}) on a US-only bid tool` });
  const gap = medianGapSeconds(t.hitTimesHour);
  if (t.hitTimesHour.length >= 30 || (gap !== null && gap < 3)) {
    out.push({
      key: "fast",
      label: `${t.hitTimesHour.length} pages this hour${gap !== null ? `, ${gap < 10 ? gap.toFixed(1) : Math.round(gap)}s apart` : ""}`,
    });
  }
  if (t.bidPagesHour >= 15) out.push({ key: "bid-sweep", label: `${t.bidPagesHour} bid pages this hour` });
  if (t.searchesHour >= 10) out.push({ key: "search-burst", label: `${t.searchesHour} radar searches this hour` });
  if (t.sameIpVisitors >= 3) out.push({ key: "ip-fanout", label: `${t.sameIpVisitors} other visitor ids on the same IP today` });
  return out;
}

/** Likely bot: an automated browser alone, or any two other signals. */
export function isLikelyScraper(signals: ScraperSignal[]): boolean {
  return signals.some((s) => s.key === "automation") || signals.length >= 2;
}

export interface TrackedVisitor {
  vid: string;
  place: string | null;
  country: string | null;
  note: string | null;
  trackedAt: string;
  lastSeen: string | null;
  views24h: number;
  /** Seen in the last 5 minutes. */
  online: boolean;
  /** Came back after it was tracked. */
  returned: boolean;
}

export interface VisitorTrail {
  vid: string;
  tracked: boolean;
  trackedAt: string | null;
  note: string | null;
  place: string | null;
  country: string | null;
  /** Raw IP: admin-only, audited, purged after the retention window. */
  ip: string | null;
  /** This IP is on the site-wide blocklist (src/lib/ip-block.server.ts). */
  ipBlocked: boolean;
  browser: string | null;
  device: string | null;
  userAgent: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  viewsTotal: number;
  viewsHour: number;
  medianGap: number | null;
  sameIpVisitors: number;
  pages: { path: string; views: number; lastAt: string }[];
  searches: { trade: string; state: string; matched: number; at: string }[];
  signals: ScraperSignal[];
  likelyScraper: boolean;
}
