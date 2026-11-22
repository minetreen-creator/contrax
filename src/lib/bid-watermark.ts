/**
 * Invisible watermark on public bid pages (owner 2026-11-05, after a bid-page
 * scraper read 348 bids in an hour through a rotating proxy pool: "Track the
 * source" → "Do all"). Each server render of /bid/:id carries a random 32-bit
 * token, written as zero-width characters inside the "What the job is" text.
 * The token is recorded (bid, hashed IP, time) in bid_watermarks. If that text
 * later shows up on another site, pasting it into the owner's lookup decodes the
 * token and names the visit that copied it.
 *
 * PURE and client-safe. Zero-width characters do not change what a reader sees
 * or what a screen reader says; a person copying the text gets them too, which
 * is harmless.
 */
const START = "⁠"; // word joiner: marks the start of a watermark
const ZERO = "​"; // zero-width space
const ONE = "‌"; // zero-width non-joiner
const TOKEN_RE = /^[0-9a-f]{8}$/;

/** A fresh random 8-hex-digit token. */
export function newWatermarkToken(): string {
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The token as invisible characters (start mark + 32 bits). */
export function encodeWatermark(token: string): string {
  if (!TOKEN_RE.test(token)) return "";
  let bits = "";
  for (const h of token) bits += parseInt(h, 16).toString(2).padStart(4, "0");
  return START + Array.from(bits, (c) => (c === "1" ? ONE : ZERO)).join("");
}

/** Every token hidden in a piece of text (copied pages may hold several). */
export function decodeWatermarks(text: string | null | undefined): string[] {
  const out: string[] = [];
  const s = String(text ?? "");
  const re = new RegExp(`${START}([${ZERO}${ONE}]{32})`, "g");
  for (const m of s.matchAll(re)) {
    const bits = Array.from(m[1], (c) => (c === ONE ? "1" : "0")).join("");
    let hex = "";
    for (let i = 0; i < 32; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    if (!out.includes(hex)) out.push(hex);
  }
  return out;
}

/** The text with the watermark placed after its first word (unchanged when there is no token). */
export function watermarkText(text: string, token: string | null | undefined): string {
  const mark = token ? encodeWatermark(token) : "";
  if (!mark) return text;
  const i = text.indexOf(" ");
  return i < 0 ? text + mark : text.slice(0, i) + mark + text.slice(i);
}

/**
 * Search and AI crawlers that say who they are (owner 2026-11-22: bid pages were opened about
 * 32,000 times a day against about 57 human visitors, and each open wrote a watermark row). A
 * mark traces a copied listing back to a visit, and a search engine is not a visit to trace. A
 * scraper pretending to be a browser, or a plain script, is still marked. PURE.
 */
const DECLARED_CRAWLERS = [
  "googlebot", "google-inspectiontool", "googleother", "adsbot-google", "bingbot", "duckduckbot", "applebot", "yandexbot", "baiduspider",
  "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-user", "perplexitybot", "amazonbot", "bytespider", "ccbot",
  "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "petalbot", "facebookexternalhit", "meta-externalagent",
];
export function isDeclaredCrawler(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? "").toLowerCase();
  return ua !== "" && DECLARED_CRAWLERS.some((c) => ua.includes(c));
}
