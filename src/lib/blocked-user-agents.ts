/**
 * Blocked browser signatures (owner 2026-10-30: "should we block them?" → "do
 * that"). Three "visitors" in Charlotte, Greensboro and Fayetteville, NC, at
 * midnight all ran an Android 9 Xiaomi Redmi 4A/5A with Chrome 106 (2022), on
 * different home and phone IPs, opened the same bid page, and went for /signup
 * and /login. That is one automated tool rotating proxies, so IP blocks can't
 * hold it; the browser string is the only handle.
 *
 * Read-only check the same night (30 days): 64 visitor ids, 202 page views,
 * Redmi 4A / 5A / Note 4 / Note 5A, all on Chrome 106, IPs from New York to
 * Indonesia and Argentina, every one arriving on a Google Ads click (64 with a
 * youtube.com referrer). 8 started a signup, none finished, no account exists.
 *
 * PURE and client-safe. vercel-entry.ts refuses a matching request with a 403;
 * BOT_EXCLUSION_SQL keeps the same signature out of every visitor count; the
 * owner console's trail flags it as automation.
 */

/** Android 9 on a Xiaomi Redmi, with exactly Chrome 106.0.0.0 Mobile. */
const REDMI_CHROME_106 = /\bAndroid 9; Redmi [^;)]*\).*\bChrome\/106\.0\.0\.0 Mobile Safari\//;

/**
 * The 2026-11-05 bid-page scraper (owner: "Track the source" → "Do all"). 458
 * one-page visits to 348 different bids in one hour from 455 IPs on 390
 * networks in 40+ countries, every one claiming a desktop browser from late
 * 2023: Chrome 118–121 (some as Edge) or Firefox 120–121, versions real
 * browsers auto-updated past years ago. A read-only check: 30 days of these
 * builds were 0–4 views a day apart from a 27-view probe on Oct 30, and no
 * signed-in Contrax user has ever been seen on one. The US-only block stops its
 * foreign exits; this stops the few US ones (5 that day).
 */
const STALE_DESKTOP_CHROME = /\((?:Windows NT 10\.0; Win64; x64|Macintosh; Intel Mac OS X 10_15_7)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/1(?:1[89]|2[01])\.0\.0\.0 Safari\/537\.36(?: Edg\/1(?:1[89]|2[01])\.0\.0\.0)?$/;
const STALE_DESKTOP_FIREFOX = /\((?:Windows NT 10\.0; Win64; x64|Macintosh; Intel Mac OS X 10\.15); rv:12[01]\.0\) Gecko\/20100101 Firefox\/12[01]\.0$/;

export const BLOCKED_USER_AGENTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "Redmi + Chrome 106 proxy bot", pattern: REDMI_CHROME_106 },
  { name: "Stale desktop Chrome 118-121 scraper", pattern: STALE_DESKTOP_CHROME },
  { name: "Stale desktop Firefox 120-121 scraper", pattern: STALE_DESKTOP_FIREFOX },
];

/** The blocked signature this user agent matches, or null. PURE. */
export function blockedUserAgent(userAgent: string | null | undefined): string | null {
  const ua = String(userAgent ?? "");
  if (!ua) return null;
  return BLOCKED_USER_AGENTS.find((b) => b.pattern.test(ua))?.name ?? null;
}

/** The same signature as a SQL predicate on a `user_agent` column (for BOT_EXCLUSION_SQL). */
export const BLOCKED_USER_AGENT_SQL = `((COALESCE(user_agent,'') LIKE '%Android 9; Redmi %' AND COALESCE(user_agent,'') LIKE '%Chrome/106.0.0.0 Mobile Safari/%') OR COALESCE(user_agent,'') ~ '\\((Windows NT 10\\.0; Win64; x64|Macintosh; Intel Mac OS X 10_15_7)\\) AppleWebKit/537\\.36 \\(KHTML, like Gecko\\) Chrome/1(1[89]|2[01])\\.0\\.0\\.0 Safari/537\\.36( Edg/1(1[89]|2[01])\\.0\\.0\\.0)?$' OR COALESCE(user_agent,'') ~ '\\((Windows NT 10\\.0; Win64; x64|Macintosh; Intel Mac OS X 10\\.15); rv:12[01]\\.0\\) Gecko/20100101 Firefox/12[01]\\.0$')`;

/**
 * Hidden, not blocked (owner 2026-10-30: "2"). Android "Chrome 138" visitors who
 * arrive on a paid ad. A read-only check (30 days): 132 visitor ids, first seen
 * Oct 6 (the Redmi bot's first day), spiking on the Redmi bot's days, 100% from
 * Google Ads (mostly YouTube), ~50 s between pages like the Redmi bot, 2 checkout
 * starts and 0 accounts. Real people on that browser can still use the site and
 * still count when they arrive any other way; only the ad-click rows are left
 * out of visitor counts.
 */
export const HIDDEN_AD_CLICK_SQL = `(COALESCE(user_agent,'') LIKE '%Android 10; K)%Chrome/138.0.0.0 Mobile Safari/%' AND COALESCE(medium,'') = 'cpc')`;

/**
 * Email link scanners (owner 2026-11-11, funnel review). Mail security gateways open every link in an
 * outreach email before the person sees it, with the tracking words scrambled so nothing is
 * "clicked" on the person's behalf: utm_medium "outreach" arrives as "bhgefbdu" (and the campaign
 * "bid_outreach_first" as "cve_bhgefbdu_avefg"). A read-only check (30 days): 39 of these "visitors",
 * none on a phone, each opening the bid and the pricing link, no search, no email given, no account,
 * no purchase. They made "email visitors look at pricing and never buy" look true. Real clicks keep
 * the word "outreach" and still count.
 */
export const EMAIL_SCANNER_SQL = `(COALESCE(medium,'') = 'bhgefbdu')`;
