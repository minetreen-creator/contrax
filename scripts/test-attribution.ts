/**
 * Standalone test for the first-touch acquisition attribution resolver
 * (src/lib/attribution.ts). Mirrors scripts/test-blocked-ip.ts style.
 * Run with: bun scripts/test-attribution.ts
 */
import {
  classifyReferrer,
  parseAttributionCookie,
  resolveAttribution,
  buildAttributionCookieValue,
  attributionCookieSetHeader,
  ATTR_COOKIE_NAME,
} from "../src/lib/attribution";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    pass++;
  } else {
    console.log(`FAIL  ${name}`);
    fail++;
  }
}

// Helper: build a cookie header containing contrax_attr=<encoded json>
function cookieFor(attrSource: string, medium = "social", campaign: string | null = null, clickId: string | null = null) {
  return `${ATTR_COOKIE_NAME}=${buildAttributionCookieValue({
    source: attrSource,
    medium,
    campaign,
    click_id: clickId,
  })}`;
}

// ── Cookie wins over query and referer ──────────────────────────────────────
{
  const attr = resolveAttribution({
    cookie: cookieFor("facebook"),
    search: "?utm_source=newsletter&utm_medium=email",
    referer: "https://reddit.com/r/govcon",
  });
  check("cookie wins over query + referer (source=facebook)", attr.source === "facebook");
  check("cookie medium preserved", attr.medium === "social");
}

// ── Query wins over referer ─────────────────────────────────────────────────
{
  const attr = resolveAttribution({
    cookie: null,
    search: "?utm_source=google&utm_medium=cpc&utm_campaign=launch",
    referer: "https://facebook.com",
  });
  check("query utm wins over referer", attr.source === "google" && attr.medium === "cpc");
  check("query campaign captured", attr.campaign === "launch");
}

// ── Referer fallback (no cookie, no query) ──────────────────────────────────
{
  const attr = resolveAttribution({
    cookie: null,
    search: "",
    referer: "https://www.linkedin.com/feed/",
  });
  check("referer fallback -> linkedin/social", attr.source === "linkedin" && attr.medium === "social");
}

// ── Direct default ──────────────────────────────────────────────────────────
{
  const attr = resolveAttribution({ cookie: null, search: "", referer: null });
  check("no cookie/query/referer -> direct", attr.source === "direct");
}

// ── fbclid -> click_id + facebook source ────────────────────────────────────
{
  const attr = resolveAttribution({
    cookie: null,
    search: "?fbclid=IwAR_abc123",
    referer: null,
  });
  check("fbclid -> source=facebook/medium=social", attr.source === "facebook" && attr.medium === "social");
  check("fbclid captured as click_id", attr.click_id === "IwAR_abc123");
}

// ── gclid -> click_id + google source ───────────────────────────────────────
{
  const attr = resolveAttribution({
    cookie: null,
    search: "?gclid=Cj0K_xyz",
    referer: null,
  });
  check("gclid -> source=google/medium=cpc", attr.source === "google" && attr.medium === "cpc");
  check("gclid captured as click_id", attr.click_id === "Cj0K_xyz");
}

// ── click_id when both utm and fbclid present takes fbclid ──────────────────
{
  const attr = resolveAttribution({
    cookie: null,
    search: "?utm_source=facebook&fbclid=F123&gclid=G456",
    referer: null,
  });
  check("utms override source/medium", attr.source === "facebook");
  check("fbclid takes precedence over gclid for click_id", attr.click_id === "F123");
}

// ── Referrer classification ─────────────────────────────────────────────────
check("classify facebook.com", JSON.stringify(classifyReferrer("https://www.facebook.com/somepath")) === JSON.stringify({ source: "facebook", medium: "social" }));
check("classify linkedin.com", JSON.stringify(classifyReferrer("https://linkedin.com/in/x")) === JSON.stringify({ source: "linkedin", medium: "social" }));
check("classify reddit.com", JSON.stringify(classifyReferrer("https://old.reddit.com/r/govcon")) === JSON.stringify({ source: "reddit", medium: "social" }));
check("classify google.com", JSON.stringify(classifyReferrer("https://www.google.com/search?q=x")) === JSON.stringify({ source: "google", medium: "organic" }));
check("classify unknown site -> null", classifyReferrer("https://example.com") === null);
check("classify null referer -> null", classifyReferrer(null) === null);

// ── Cookie parsing / round-trip ─────────────────────────────────────────────
{
  const cookie = cookieFor("twitter", "social", "summer", "tw123");
  const parsed = parseAttributionCookie(cookie);
  check("round-trip cookie parse", parsed?.source === "twitter" && parsed?.medium === "social" && parsed?.campaign === "summer" && parsed?.click_id === "tw123");
  check("parse no cookie -> null", parseAttributionCookie(null) === null);
  check("parse malformed cookie -> null", parseAttributionCookie(`${ATTR_COOKIE_NAME}=not-json-{{`) === null);
}

// ── Set-Cookie attributes (owner-specified) ─────────────────────────────────
{
  const header = attributionCookieSetHeader({ source: "facebook", medium: "social", campaign: null, click_id: "abc" });
  check("cookie path=/ ", header.includes("Path=/"));
  check("cookie SameSite=Lax", header.includes("SameSite=Lax"));
  check("cookie Max-Age=2592000 (30d)", header.includes("Max-Age=2592000"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
