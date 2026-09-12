/**
 * Pure signup telemetry helpers — PR #374 extension (owner 09-12).
 *
 * Single home for the pure logic behind the signup diagnostic instrumentation:
 * acquisition-path attribution, the signup_exit payload, the signup_field_error
 * payload, and the server-side idempotency-key derivation for the signup
 * one-shot event family.
 *
 * IMPORTANT (build safety): this module is imported by the CLIENT bundle
 * (src/routes/signup.tsx) so it must NOT statically import any Node builtin
 * (`node:crypto`, `node:fs`, …) or server-only module — TanStack Start's
 * import-protection fails the build otherwise. The HMAC below therefore uses
 * the Web Crypto API (`crypto.subtle`), which is available in browsers, on
 * the server (Node 18+/Bun), and in `bun test` — same HMAC-SHA-256 algorithm
 * as node:crypto (the task brief said "node:crypto HMAC"; this is the
 * client-bundle-safe equivalent — see vite.config.ts moduleSideEffects rule).
 *
 * No DB access, no server-only imports — importable by `bun test` standalone.
 */

// ── Acquisition-path buckets (owner spec — unchanged from the PR's local set) ──
//   radar          — radar / unlock / radar-results-CTA source, or same-site /radar referrer
//   autopsy        — autopsy source, or same-site /autopsy referrer
//   bid_scout      — same-site referrer path starts with /bid-scout
//   awards         — incumbent source, or same-site /awards referrer
//   home           — closing_soon source, or any other same-site referrer
//   external       — cross-site referrer (facebook/google/etc.)
//   internal_other — no referrer / unknown / malformed
export const ACQUISITION_BUCKETS = [
  "radar",
  "autopsy",
  "bid_scout",
  "awards",
  "home",
  "external",
  "internal_other",
] as const;
export type AcquisitionBucket = (typeof ACQUISITION_BUCKETS)[number];

/**
 * Existing allowlisted ?source= values → bucket mapping (owner 09-12).
 *   radar | radar_results_unlock | radar_results_cta → "radar"
 *   autopsy → "autopsy"
 *   closing_soon → "home" (the homepage Closing Soon section)
 *   incumbent → "awards" (the IncumbentCard gate lives on /awards)
 * The URL param survives SPA client-side nav, redirects and restored sessions —
 * document.referrer does NOT — so it takes precedence over the referrer.
 */
const SOURCE_TO_BUCKET: Record<string, AcquisitionBucket> = {
  radar: "radar",
  radar_results_unlock: "radar",
  radar_results_cta: "radar",
  autopsy: "autopsy",
  closing_soon: "home",
  incumbent: "awards",
};

/** First-party hostnames treated as same-site when no window.location exists
 *  (bun test, SSR render). In the browser the live origin always wins. */
const FIRST_PARTY_HOSTS = ["contrax.company", "www.contrax.company", "localhost"];

function currentPageOrigin(): string {
  // Browser first; guard everything so this module is safe in bun/SSR.
  try {
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
    if (typeof location !== "undefined" && (location as { origin?: string }).origin) {
      return (location as { origin: string }).origin;
    }
  } catch {
    /* no usable location — fall through */
  }
  return "";
}

function isSameSite(referrerUrl: URL): boolean {
  const origin = currentPageOrigin();
  if (origin) return referrerUrl.origin === origin;
  const host = referrerUrl.hostname.toLowerCase();
  return FIRST_PARTY_HOSTS.includes(host) || host.endsWith(".contrax.company");
}

/**
 * Acquisition-path resolution — source param first, referrer fallback.
 *
 * Behavior when sourceParam is absent is IDENTICAL to the PR's existing
 * referrer-only resolution: same-site referrer path → bucket by path prefix,
 * cross-site referrer → "external", absent/malformed referrer →
 * "internal_other".
 */
export function resolveAcquisitionPath(
  sourceParam: string | undefined,
  referrer: string | undefined | null,
): AcquisitionBucket {
  // 1. Allowlisted source param takes precedence (survives nav/redirects).
  if (sourceParam) {
    const bucket = SOURCE_TO_BUCKET[sourceParam];
    if (bucket) return bucket;
  }
  // 2. Same-site referrer path fallback — exactly the PR's bucket rules.
  if (referrer) {
    try {
      const url = new URL(referrer);
      if (isSameSite(url)) {
        if (url.pathname.startsWith("/radar")) return "radar";
        if (url.pathname.startsWith("/autopsy")) return "autopsy";
        if (url.pathname.startsWith("/bid-scout")) return "bid_scout";
        if (url.pathname.startsWith("/awards")) return "awards";
        return "home";
      }
      return "external";
    } catch {
      // malformed referrer — fall through to internal_other
    }
  }
  return "internal_other";
}

// ── signup_exit payload builder (owner 09-12) ──
// The behavior that previously produced 0 rows: the old code refused to fire
// when the form was never started. buildExitPayload labels the cohort instead:
// "view" (never touched the form) vs "form_started", and seconds are measured
// from PAGE VIEW (mount), not form start.
export interface ExitPathPayload {
  label: "view" | "form_started";
  seconds_on_page: number;
  from: AcquisitionBucket;
}
export function buildExitPayload(input: {
  secondsOnPage: number;
  formStarted: boolean;
  from: AcquisitionBucket;
}): ExitPathPayload {
  return {
    label: input.formStarted ? "form_started" : "view",
    seconds_on_page: Math.max(0, Math.round(input.secondsOnPage)),
    from: input.from,
  };
}

// ── signup_field_error payload builder (owner 09-12) ──
// `field` is a STRICT allowlist: email | password | multiple. Anything outside
// is coerced to "multiple" so a field NAME (never the entered value) is all
// that can ever appear. `message` is the short human text, truncated.
export const FIELD_ERROR_FIELDS = ["email", "password", "multiple"] as const;
export type FieldErrorField = (typeof FIELD_ERROR_FIELDS)[number];
export interface FieldErrorPayload {
  field: FieldErrorField;
  error: string;
}
export function buildFieldErrorPayload(field: unknown, message: string): FieldErrorPayload {
  const f = typeof field === "string" && (FIELD_ERROR_FIELDS as readonly string[]).includes(field)
    ? (field as FieldErrorField)
    : "multiple";
  return { field: f, error: String(message ?? "").slice(0, 160) };
}

// ── Server-side duplicate suppression (owner REV 4 gate 1) ──
// The DB uniqueness rule: a partial unique index on funnel_events.dedupe_key
// (WHERE dedupe_key IS NOT NULL) + INSERT ... ON CONFLICT (dedupe_key) DO
// NOTHING. The key is derived SERVER-SIDE from the server secret, visitor id,
// event name and a SERVER-ISSUED attempt token — never a browser-minted value.
//
// Issuance (owner REV 4 clause 1): the /signup SSR loader mints ONE signed
// session token per page load and stores it in the HttpOnly `signup_attempt`
// cookie (Path=/, SameSite=Lax — the client never reads or mints it; requests
// carry it back automatically). A new page load overwrites the cookie with a
// NEW token → new attempt → new key; retries / double-fires of the same page
// session reuse the SAME cookie → SAME key (atomic ON CONFLICT collapse).
// The server validates signature + version + expiry before deriving anything,
// so a captured/re-minted id cannot key a DIFFERENT attempt (an HMAC alone
// authenticates but does not prevent replay — issuance is what binds the key).
// Invalid/missing/expired token → dedupe_key NULL → event still recorded.
export const SIGNUP_ONE_SHOT_EVENTS: ReadonlySet<string> = new Set([
  "signup_exit",
  "signup_abandon",
  "signup_submit",
  "signup_success",
  "signup_field_error",
  "signup_submit_error",
]);

/** HttpOnly signup-attempt session cookie, set by the /signup SSR loader. */
export const SIGNUP_ATTEMPT_COOKIE = "signup_attempt";
/** Token/cookie lifetime — 30 minutes, matching the recommended design. */
export const SIGNUP_ATTEMPT_MAX_AGE_S = 30 * 60;
/** Signed-token payload version. Bumped only on a breaking payload change. */
export const SIGNUP_ATTEMPT_VERSION = 1 as const;

/** Signed attempt-token payload (server-minted, no PII by construction). */
export interface SignupSessionTokenPayload {
  v: typeof SIGNUP_ATTEMPT_VERSION;
  /** Server random nonce (hex). */
  n: string;
  /** Expiry epoch ms. */
  exp: number;
}

/** `base64url(payload) "." hmacSha256Hex(secret, base64url(payload))`. */
const ATTEMPT_TOKEN_RE =
  /^[A-Za-z0-9_-]{1,256}\.[0-9a-f]{64}$/;
/** Shape check for a SIGNED attempt token (b64url payload + 64-hex sig). */
export function isValidAttemptToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 521 && ATTEMPT_TOKEN_RE.test(value);
}

/**
 * Server secret for the dedupe key. Uses the existing RADAR_HANDOFF_SECRET
 * (already set in the Vercel prod env) with a clearly-marked LOCAL-ONLY
 * fallback so `bun test` / local dev can exercise the machinery. The fallback
 * NEVER engages in production (NODE_ENV === "production" → null → dedupe
 * degrades to off, events still recorded). The secret is never logged.
 */
export function resolveDedupeSecret(): string | null {
  if (typeof process !== "undefined" && process.env?.RADAR_HANDOFF_SECRET) {
    return process.env.RADAR_HANDOFF_SECRET;
  }
  if (typeof process === "undefined" || process.env.NODE_ENV !== "production") {
    return "signup-dedupe-local-dev-only-fallback";
  }
  return null;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive the server-side dedupe key: HMAC-SHA256(secret, visitorId \0 eventName
 * \0 validatedToken) hex. Deterministic (pure) — the SAME inputs always yield
 * the SAME key. Returns null (fail-open — no dedupe, event still recorded) when
 * the secret, visitor id, event name or validated attempt token are
 * missing/invalid, so callers never hash junk and never log anything.
 *
 * `validatedToken` is the FULL signed attempt token (base64url-payload +
 * signature) that already passed verifySignupSessionToken — never a raw
 * browser value, and never a re-mintable UUID. Same token → same key
 * (retry-reuse); a new server-issued token → new key (new-attempt rule).
 */
export async function deriveDedupeKey(
  secret: string | null | undefined,
  visitorId: string | null | undefined,
  eventName: string | null | undefined,
  validatedToken: unknown,
): Promise<string | null> {
  if (!secret || !visitorId || !eventName) return null;
  if (!isValidAttemptToken(validatedToken)) return null; // malformed → not called with a key
  return hmacSha256Hex(secret, `${visitorId}\u0000${eventName}\u0000${validatedToken}`);
}

// ── Server-issued attempt-token helpers (owner REV 4 gate 1) ──
// Issuance lives on the SERVER (the /signup SSR loader mints one token per
// page load and stores it in the HttpOnly `signup_attempt` cookie). The client
// never mints and never reads it. These helpers are pure + bun-importable:
// base64url (RFC 4648 §5, no padding) + HMAC-SHA256 via crypto.subtle + a
// constant-time-ish hex signature compare.

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 base64url WITHOUT padding — safe for cookie values (no '='). */
function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += B64URL_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    out += B64URL_ALPHABET[b2 & 63];
  }
  // Strip the implicit padding (RFC 4648 §5 — pad chars are URL-unsafe).
  const mod = bytes.length % 3;
  if (mod === 1) return out.slice(0, -2);
  if (mod === 2) return out.slice(0, -1);
  return out;
}

/** Inverse of toBase64Url; throws on any non-alphabet char (never '='). */
function fromBase64Url(value: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of value) {
    const idx = B64URL_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base64url char");
    buf = (buf << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Mint a fresh server nonce for the token payload: 32 hex chars (16 random
 * bytes) from crypto.getRandomValues — never client input, never clock-only.
 */
export function mintAttemptNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish hex compare — no early exit on the first differing byte. */
function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Sign an attempt-token payload: `base64url(JSON(payload)) "." hex(HMAC-SHA256(
 * secret, base64url)). Throws on a missing secret (callers decide their own
 * fail-open; the signup loader catches and serves with no cookie → dedupe off).
 * The payload NEVER carries PII by construction (version + nonce + expiry only).
 * The version is NOT enforced here — verifySignupSessionToken is the gate (a
 * non-1 version simply never verifies), so the reject path is testable and the
 * server loader always passes SIGNUP_ATTEMPT_VERSION anyway.
 */
export async function signSignupSessionToken(
  payload: SignupSessionTokenPayload,
): Promise<string> {
  const secret = resolveDedupeSecret();
  if (!secret) throw new Error("signup attempt-token: no server secret configured");
  const json = JSON.stringify({ v: payload.v, n: payload.n, exp: payload.exp });
  const payloadB64 = toBase64Url(new TextEncoder().encode(json));
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a raw `signup_attempt` cookie value. Returns the payload on success,
 * or null on ANY failure (missing/oversized/not-a-string, malformed shape,
 * bad base64url, signature mismatch, wrong version, expired). Never throws.
 * Fail-open contract: callers treat null as "no attempt token" → dedupe_key
 * NULL → the event is still recorded (byte-identical to today's no-key path).
 */
export async function verifySignupSessionToken(
  rawToken: unknown,
  opts: { nowMs: number },
): Promise<SignupSessionTokenPayload | null> {
  if (typeof rawToken !== "string" || rawToken.length === 0 || rawToken.length > 521) {
    return null;
  }
  const dot = rawToken.indexOf(".");
  if (dot <= 0 || dot === rawToken.length - 1) return null;
  const payloadB64 = rawToken.slice(0, dot);
  const sigHex = rawToken.slice(dot + 1);
  if (payloadB64.length > 256 || !/^[A-Za-z0-9_-]+$/.test(payloadB64)) return null;
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return null;
  const secret = resolveDedupeSecret();
  if (!secret) return null;
  // Recompute the signature over the exact payload bytes — a forged payload
  // fails here regardless of what it contains.
  const expected = await hmacSha256Hex(secret, payloadB64);
  if (!safeCompareHex(expected, sigHex)) return null;

  let payload: unknown;
  try {
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.v !== SIGNUP_ATTEMPT_VERSION) return null;
  if (typeof p.n !== "string" || p.n.length === 0 || p.n.length > 128) return null;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp) || p.exp <= opts.nowMs) return null;
  return { v: p.v, n: p.n, exp: p.exp };
}

/**
 * Pull + validate the `signup_attempt` cookie from a raw Cookie header.
 * Returns the RAW token string on success (it is the validated attempt basis
 * for deriveDedupeKey) or null (fail-open) when absent/invalid/expired.
 */
export async function readValidatedAttemptToken(
  cookieHeader: string | null | undefined,
  opts: { nowMs: number },
): Promise<string | null> {
  if (!cookieHeader) return null;
  const prefix = `${SIGNUP_ATTEMPT_COOKIE}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const raw = trimmed.slice(prefix.length).trim();
      const ok = await verifySignupSessionToken(raw, opts);
      return ok ? raw : null;
    }
  }
  return null;
}

// ── Redaction guard (used by tests) ──
// Asserts that no sensitive raw value (email, password, field value) appears
// anywhere in an analytics payload, event name, label, path or key.
export function containsSensitiveString(value: unknown, sensitive: string[]): boolean {
  if (value == null) return false;
  const haystack = typeof value === "string" ? value : JSON.stringify(value);
  if (!haystack) return false;
  return sensitive.some((s) => typeof s === "string" && s.length > 0 && haystack.includes(s));
}