/**
 * First-touch acquisition attribution.
 *
 * A small, pure, dependency-free module shared by:
 *   - the client snippet (src/routes/__root.tsx) which sets the 30-day
 *     `contrax_attr` cookie ONCE on first arrival, and
 *   - the server handlers (src/routes/api/page-view.ts, src/routes/api/event.ts)
 *     which stamp the resolved attribution onto every page_view / funnel_event row.
 *
 * Resolution precedence (spec'd by the owner), cookie first:
 *   1. cookie  (contrax_attr)  — canonical first-touch, set client-side
 *   2. query   (utm_source/utm_medium/utm_campaign, fbclid, gclid) — cookie-blocker fallback
 *   3. referer (fb/li/reddit/google classification) — last-resort fallback
 *   4. direct
 *
 * This module MUST stay pure — no DB, no browser-only globals — so the client
 * snippet and the server can both import it, and bun CLI test scripts can import
 * it without a browser or a database. The only globals used are `URLSearchParams`
 * (available in Node, Bun, and browsers).
 */

export interface Attribution {
  source: string;
  medium: string;
  campaign: string | null;
  click_id: string | null;
}

export interface AttributionInput {
  /** Raw Cookie header (server: request.headers.get("cookie")) or document.cookie (client). */
  cookie?: string | null;
  /** URL query string INCLUDING the leading "?" (server: new URL(request.url).search; client: location.search). */
  search?: string | null;
  /** Referring page URL or null (server: referer header / body referrer; client: document.referrer). */
  referer?: string | null;
}

export const ATTR_COOKIE_NAME = "contrax_attr";
/** 30 days, owner-specified. */
export const ATTR_COOKIE_MAX_AGE = 2592000;

/** Extract a single cookie value from a raw Cookie header / document.cookie string. */
export function getCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const val = part.slice(idx + 1).trim();
      return val.length ? val : null;
    }
  }
  return null;
}

/**
 * Parse the `contrax_attr` cookie value. The value is stored as
 * encodeURIComponent(JSON.stringify({...})), so we decode before parsing.
 * Returns null when absent or malformed.
 */
export function parseAttributionCookie(
  cookieHeader: string | null | undefined,
): Attribution | null {
  const raw = getCookieValue(cookieHeader, ATTR_COOKIE_NAME);
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(decoded) as Record<string, unknown>;
    if (obj && typeof obj.source === "string" && obj.source) {
      return {
        source: obj.source.slice(0, 128),
        medium:
          typeof obj.medium === "string" && obj.medium
            ? obj.medium.slice(0, 128)
            : "referral",
        campaign:
          typeof obj.campaign === "string" && obj.campaign
            ? obj.campaign.slice(0, 256)
            : null,
        click_id:
          typeof obj.click_id === "string" && obj.click_id
            ? obj.click_id.slice(0, 200)
            : null,
      };
    }
  } catch {
    // malformed JSON — ignore
  }
  return null;
}

/**
 * Resolve a source/medium from a URL query string (utm_* / fbclid / gclid).
 * Returns null when the query carries no usable attribution (so the caller can
 * fall through to referer classification). `gclid`/`fbclid` map to a clean
 * source/medium when no utm_* tag is present.
 */
export function parseQueryAttribution(
  search: string | null | undefined,
): Attribution | null {
  if (!search) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    );
  } catch {
    return null;
  }
  const utmSource = params.get("utm_source")?.trim();
  const utmMedium = params.get("utm_medium")?.trim();
  const utmCampaign = params.get("utm_campaign")?.trim();
  const fbclid = params.get("fbclid")?.trim();
  const gclid = params.get("gclid")?.trim();

  const click_id = fbclid || gclid || null;

  if (utmSource) {
    return {
      source: utmSource.slice(0, 128),
      medium: utmMedium?.slice(0, 128) || "referral",
      campaign: utmCampaign?.slice(0, 256) || null,
      click_id: click_id?.slice(0, 200) ?? null,
    };
  }
  if (fbclid) {
    return { source: "facebook", medium: "social", campaign: null, click_id: fbclid.slice(0, 200) };
  }
  if (gclid) {
    return { source: "google", medium: "cpc", campaign: null, click_id: gclid.slice(0, 200) };
  }
  return null;
}

/**
 * Classify a referring URL into a clean source/medium. Returns null when the
 * referrer isn't one we recognize (so the caller defaults to direct).
 */
export function classifyReferrer(
  referer: string | null | undefined,
): { source: string; medium: string } | null {
  if (!referer) return null;
  const r = referer.toLowerCase();
  if (r.includes("facebook.com") || r.includes("fb.com") || r.includes("facebook")) {
    return { source: "facebook", medium: "social" };
  }
  if (r.includes("linkedin.com") || r.includes("linkedin")) {
    return { source: "linkedin", medium: "social" };
  }
  if (r.includes("reddit.com") || r.includes("reddit")) {
    return { source: "reddit", medium: "social" };
  }
  if (r.includes("google.") || r.includes("googlebot") || r.includes("google")) {
    return { source: "google", medium: "organic" };
  }
  return null;
}

/**
 * Resolve attribution for a request/first-arrival in the spec's precedence
 * order: cookie → query → referer → direct. Never throws; always returns a
 * well-formed Attribution.
 */
export function resolveAttribution(input: AttributionInput): Attribution {
  const fromCookie = parseAttributionCookie(input.cookie);
  if (fromCookie) return fromCookie;

  const fromQuery = parseQueryAttribution(input.search);
  if (fromQuery) return fromQuery;

  const fromReferer = classifyReferrer(input.referer);
  if (fromReferer) return { ...fromReferer, campaign: null, click_id: null };

  return { source: "direct", medium: "(none)", campaign: null, click_id: null };
}

/** The localStorage-free, encoded cookie VALUE (before Set-Cookie attributes). */
export function buildAttributionCookieValue(attr: Attribution): string {
  return encodeURIComponent(JSON.stringify(attr));
}

/**
 * Full Set-Cookie value for the `contrax_attr` cookie with the owner-specified
 * attributes: Path=/ (sent on /signup, /pricing, /api/*), SameSite=Lax
 * (persists across FB/LinkedIn cross-site navigation), Max-Age=2592000 (30 days).
 */
export function attributionCookieSetHeader(attr: Attribution): string {
  return `${ATTR_COOKIE_NAME}=${buildAttributionCookieValue(attr)}; Path=/; SameSite=Lax; Max-Age=${ATTR_COOKIE_MAX_AGE}`;
}
