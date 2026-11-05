/**
 * Scraper alarm (owner 2026-11-05: "Do both", after a bid-page scraper read
 * ~460 bid pages in an hour through a rotating proxy pool and was found by eye).
 * Real visitors arrive a few an hour; the scraper was dozens of one-page bid
 * visits a minute, each from a different address. This decides when a burst
 * looks like that, and words the owner's push. PURE.
 */
export const ALARM_WINDOW_MINUTES = 10;
/** Normal traffic is ~3-60 page views an hour in total; 25 one-page bid visitors in 10 minutes is not people. */
export const ALARM_MIN_SINGLE_PAGE_VISITORS = 25;
export const ALARM_MIN_ADDRESSES = 20;
/** Share of the window's bid-only visitors who read exactly one page. */
export const ALARM_MIN_SINGLE_SHARE = 0.8;
/** At most one push per hour; a running scrape is one incident. */
export const ALARM_COOLDOWN_MINUTES = 60;

export interface BurstStats {
  /** Visitors in the window whose every page was a /bid/ page. */
  bidOnlyVisitors: number;
  /** Of those, how many read exactly one page. */
  singlePageVisitors: number;
  /** Distinct addresses among them. */
  addresses: number;
  bidViews: number;
}

export function isScraperBurst(s: BurstStats): boolean {
  if (s.singlePageVisitors < ALARM_MIN_SINGLE_PAGE_VISITORS) return false;
  if (s.addresses < ALARM_MIN_ADDRESSES) return false;
  return s.bidOnlyVisitors > 0 && s.singlePageVisitors / s.bidOnlyVisitors >= ALARM_MIN_SINGLE_SHARE;
}

export function scraperAlarmPush(
  s: BurstStats,
  countries: { country: string; n: number }[],
  browsers: { browser: string; n: number }[],
): { title: string; body: string; tag: string; url: string } {
  const where = countries.slice(0, 4).map((c) => `${c.country} ${c.n}`).join(", ");
  const top = browsers[0] ? ` Top browser: ${browsers[0].browser}.` : "";
  return {
    title: `🚨 Scraper alarm: ${s.bidViews} bid pages in ${ALARM_WINDOW_MINUTES} min`,
    body: `${s.singlePageVisitors} one-page visitors from ${s.addresses} addresses${where ? ` (${where})` : ""}.${top} Details saved; open Live.`,
    tag: "scraper-alarm",
    url: "/admin/live",
  };
}
