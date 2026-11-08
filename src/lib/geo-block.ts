/**
 * US-only access (owner 2026-11-05: a wave of one-page visits to random bid
 * pages from Karachi, Lahore, Dhaka, Mexico City, São Paulo and more → "It's too
 * many to block" → "Block non-US"). Read-only check that hour: 59 page views vs
 * 3 the same hour the day before, 61 of 63 visitors viewed exactly one page, 57
 * had no referrer, all desktop Windows Chrome/Edge, 0 signups. Per-IP blocking
 * cannot keep up with a rotating proxy pool; Contrax lists U.S. government bids
 * only, so the rule is by country.
 *
 * PURE. vercel-entry.ts refuses a blocked request with a 403 before any page,
 * API or tracking runs (so these hits no longer reach the visitor counts).
 *
 * Owner 2026-11-05 ("Remove the signed-in exception, block everyone"): a
 * signed-in browser outside the U.S. is refused too.
 *
 * Never blocked:
 * - an unknown country (no Vercel geo header: local runs, previews) — fail open;
 * - U.S. states and territories;
 * - machine endpoints that must work from anywhere: Stripe and other webhooks,
 *   Vercel Cron, robots.txt, sitemaps and /.well-known.
 */
export const ALLOWED_COUNTRIES: ReadonlySet<string> = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

const EXEMPT_PATH = /^\/(?:api\/stripe\/|api\/webhooks\/|api\/cron\/|robots\.txt$|sitemap[^/]*\.xml$|\.well-known\/)/;

export const GEO_BLOCK_MESSAGE =
  "Contrax lists U.S. government bids and is available in the United States only. On a VPN? Turn it off or choose a U.S. location. Think this is a mistake? Email contrax.companyllc@gmail.com.";

/** What a blocked address or browser sees (owner 2026-11-08: a real contractor on a shared phone
 *  or office address must have a way to reach us, not a dead end). */
export const ACCESS_BLOCK_MESSAGE =
  "Access denied. If you're a contractor and think this is a mistake, email contrax.companyllc@gmail.com with your city, and we'll fix it.";

export function geoBlocked(args: { country: string | null | undefined; pathname: string }): boolean {
  const country = String(args.country ?? "").trim().toUpperCase();
  if (!country) return false;
  if (ALLOWED_COUNTRIES.has(country)) return false;
  if (EXEMPT_PATH.test(args.pathname)) return false;
  return true;
}
