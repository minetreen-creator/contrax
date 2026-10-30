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

export const BLOCKED_USER_AGENTS: readonly { name: string; pattern: RegExp }[] = [
  { name: "Redmi + Chrome 106 proxy bot", pattern: REDMI_CHROME_106 },
];

/** The blocked signature this user agent matches, or null. PURE. */
export function blockedUserAgent(userAgent: string | null | undefined): string | null {
  const ua = String(userAgent ?? "");
  if (!ua) return null;
  return BLOCKED_USER_AGENTS.find((b) => b.pattern.test(ua))?.name ?? null;
}

/** The same signature as a SQL predicate on a `user_agent` column (for BOT_EXCLUSION_SQL). */
export const BLOCKED_USER_AGENT_SQL = `(COALESCE(user_agent,'') LIKE '%Android 9; Redmi %' AND COALESCE(user_agent,'') LIKE '%Chrome/106.0.0.0 Mobile Safari/%')`;

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
