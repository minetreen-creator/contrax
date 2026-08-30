/**
 * Client geo + device context for the self-hosted analytics (owner 2026-09-01).
 *
 * PURPOSE: the admin "Visitor Journeys" board replaces the generic
 * "Anonymous <last4>" label with recognizable geo/behavioral context
 * ("Dallas, TX · Desktop", "Direct Lead · /example-brief"). This module is the
 * single parser that derives that context at beacon-ingestion time, from the
 * Vercel edge request headers plus a light user-agent parse:
 *
 *   - `x-vercel-ip-city`          → city          (e.g. "Austin")
 *   - `x-vercel-ip-country-region`→ region        (e.g. "TX")
 *   - `user-agent`                → device_type   ("Desktop" | "Mobile")
 *                                  + browser/OS label ("Chrome · Windows")
 *
 * FAIL-OPEN: geolocation headers are optional (Vercel sometimes omits them for
 * cached/datacenter IPs) and the UA is any arbitrary string, so every field is
 * nullable and every parse is defensive — absent/unknown input yields null, never
 * a thrown error. The beacon endpoints must never break because of a missing or
 * odd header.
 *
 * HYGIENE: this module exposes ONLY city / region / device / browser labels. It
 * never reads, stores, or returns a raw IP or full user-agent string. The short
 * per-visitor hash is derived elsewhere from the visitor_id, not the UA.
 *
 * PLEASE NOTE: this module MUST stay PURE — no server-only imports, no DB access,
 * no node builtins — matching page-view.ts / event.ts, which must stay compatible
 * with the client-bundle protection.
 */

export interface ClientContext {
  /** Approximate city from Vercel edge headers, e.g. "Dallas". Null if absent. */
  city: string | null;
  /** Approximate country region from Vercel edge headers, e.g. "TX". Null if absent. */
  region: string | null;
  /** "Desktop" | "Mobile" (tablets count as Mobile). Null if UA was unrecognizable. */
  device_type: "Desktop" | "Mobile" | null;
  /** Human-readable browser + OS label, e.g. "Chrome · Windows". Null if unknown. */
  browser_label: string | null;
}

const GEO_HEADERS = ["x-vercel-ip-city", "x-vercel-ip-country-region"] as const;

function clean(value: string | null, max = 64): string | null {
  if (!value) return null;
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return null;
  return v.slice(0, max);
}

/**
 * Parse the Vercel edge geo headers into { city, region }. Always fail-open:
 * any missing/empty header resolves to null.
 */
function parseGeo(request: Request): { city: string | null; region: string | null } {
  const city = clean(request.headers.get(GEO_HEADERS[0]));
  const region = clean(request.headers.get(GEO_HEADERS[1]));
  return { city, region };
}

/** Detect a coarse device class from a user-agent. Tablets are treated as Mobile. */
function detectDeviceType(ua: string): "Desktop" | "Mobile" | null {
  if (/mobile|android|iphone|ipod|ipad|phone|iemobile|opera mini|wp(?:hone|7|8)|blackberry/i.test(ua)) {
    return "Mobile";
  }
  // If we can positively identify a desktop platform, say Desktop; otherwise we
  // can't be sure, so stay conservative and return null rather than guess.
  if (/windows|macintosh|mac os x|x11|linux|ubuntu|cros/i.test(ua)) {
    return "Desktop";
  }
  return null;
}

function detectBrowser(ua: string): string | null {
  const l = ua.toLowerCase();
  if (l.includes("edg/") || l.includes("edge/")) return "Edge";
  if (l.includes("opera") || l.includes("opr/")) return "Opera";
  if (l.includes("samsungbrowser")) return "Samsung Internet";
  if (l.includes("chrome")) return l.includes("mobile") || l.includes("android") ? "Chrome Mobile" : "Chrome";
  if (l.includes("firefox")) return "Firefox";
  if (l.includes("safari")) return "Safari";
  return null;
}

function detectOs(ua: string): string | null {
  const l = ua.toLowerCase();
  if (l.includes("windows")) return "Windows";
  if (l.includes("android")) return "Android";
  if (l.includes("iphone") || l.includes("ipad") || l.includes("ipod")) return "iOS";
  if (l.includes("mac os x") || l.includes("macintosh")) return "macOS";
  if (l.includes("linux")) return "Linux";
  if (l.includes("cros")) return "ChromeOS";
  return null;
}

/** Light, defensive browser + OS label ("Chrome · Windows"). Null when unknown. */
function parseBrowserLabel(ua: string): string | null {
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  if (!browser && !os) return null;
  const parts = [browser, os].filter(Boolean) as string[];
  return parts.join(" · ");
}

/**
 * Derive the full client context (city / region / device / browser) from an
 * incoming request. Pure, fail-open, never throws.
 */
export function parseClientContext(request: Request): ClientContext {
  const { city, region } = parseGeo(request);
  const rawUa = (request.headers.get("user-agent") ?? "").slice(0, 512);
  let device_type: ClientContext["device_type"] = null;
  let browser_label: string | null = null;
  if (rawUa) {
    try {
      device_type = detectDeviceType(rawUa);
      browser_label = parseBrowserLabel(rawUa);
    } catch {
      // Defensive: a weird UA must never break the beacon.
    }
  }
  return { city, region, device_type, browser_label };
}
