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

// ── Server-side duplicate suppression (owner REV 5, 2026-09-12) ──
// The DB uniqueness rule: a partial unique index on funnel_events.dedupe_key
// (WHERE dedupe_key IS NOT NULL) + INSERT ... ON CONFLICT (dedupe_key) DO
// NOTHING. The key is derived SERVER-SIDE from the server secret, the event
// name, an event-level dedupe SCOPE const, and a VALIDATED SERVER-ISSUED
// attempt token — never a browser-minted value, and never an HttpOnly cookie.
//
// REV 5 (owner 09-12, SUPERSEDES the REV 4 cookie design): the /signup SSR
// loader STILL mints one signed expiring token per page load and RETURNS it in
// the page data (no Set-Cookie). The client stores it in TAB-SCOPED
// sessionStorage (key SIGNUP_ATTEMPT_SESSION_KEY) and attaches it to EVERY
// signup-family telemetry request body (/api/event, /api/track-visitor,
// /api/signup — field `attempt_token`). When the tab has no stored token
// (first visit; new tab = fresh sessionStorage) the client adopts the
// loader-supplied token when it BINDS to the tab's own visitor/visit identity,
// otherwise it obtains a fresh server-signed token bound to that identity via
// the mintSignupAttemptToken server fn (signup.tsx). Reloads / SPA nav reuse
// the stored unexpired token (sessionStorage survives both) → the SAME
// attempt keeps the SAME key; completion retires it (removeItem) → the next
// page load mints a fresh token (rotation). A separately opened tab has its own
// sessionStorage → its own token → INDEPENDENT key per tab.
//
// The server performs FOUR checks before dedupe (classifySignupAttemptToken):
//   1. signature (HMAC-SHA256 with RADAR_HANDOFF_SECRET) → fail → forged
//   2. expiry (exp > now)                                        → fail → expired
//   3. event scope: only SIGNUP_ONE_SHOT_EVENTS; any other event carrying a
//      token is IGNORED (no dedupe, no flag → dedupe_status NULL)
//   4. visitor/session BINDING: the token's signed visitorId/visitId must
//      equal the request's resolved visitor/visit (the server's own tracking
//      identity for this request: body visitor_id/visit_id) → mismatch → forged
// Missing token → fail_open_missing. Every fail-open path still RECORDS the
// event with dedupe_key NULL and funnel_events.dedupe_status set to the reason
// ('applied' | 'fail_open_missing' | 'fail_open_forged' | 'fail_open_expired').
// Non-signup events keep dedupe_key NULL AND dedupe_status NULL (byte-identical
// behavior — the partial unique index only covers non-null keys).
export const SIGNUP_ONE_SHOT_EVENTS: ReadonlySet<string> = new Set([
  "signup_exit",
  "signup_abandon",
  "signup_submit",
  "signup_success",
  "signup_field_error",
  "signup_submit_error",
]);

/** Funnel dedupe-status values for the signup one-shot family (REV 5 clause 5). */
export type DedupeStatus =
  | "applied"
  | "fail_open_missing"
  | "fail_open_forged"
  | "fail_open_expired";

/** Tab-scoped sessionStorage key holding the signup attempt token (REV 5). */
export const SIGNUP_ATTEMPT_SESSION_KEY = "signup_attempt_token";
/** Token lifetime — 30 minutes, matching the recommended design. */
export const SIGNUP_ATTEMPT_MAX_AGE_S = 30 * 60;
/** Signed-token payload version. Bumped only on a breaking payload change. */
export const SIGNUP_ATTEMPT_VERSION = 1 as const;
/** Event-level dedupe scope const (REV 5 clause 6) — part of the key input so a
 *  future scope ("signup_oneshot" today) can never collide with an old one. */
export const SIGNUP_DEDUPE_SCOPE = "signup_oneshot" as const;

/**
 * Signed attempt-token payload (server-minted, no PII by construction).
 * `visitorId` / `visitId` are the BINDING fields (REV 5 clause 4): the server
 * signs the tab's visitor + visit identity INTO the token so a token captured
 * from one tab/visitor can never key another attempt's dedupe. Both are always
 * present after signing (empty string when unknown at mint time — the SSR
 * loader cannot see a per-tab sessionStorage visit id, so first-visit tokens
 * are re-minted bound to the tab's real identity before first use).
 */
export interface SignupSessionTokenPayload {
  v: typeof SIGNUP_ATTEMPT_VERSION;
  /** Server random nonce (hex). */
  n: string;
  /** Expiry epoch ms. */
  exp: number;
  /** Binding field — the persistent visitor id (contrax_vid) at mint time. */
  visitorId: string;
  /** Binding field — the per-tab visit id (sessionStorage) at mint time. */
  visitId: string;
}

/** `base64url(payload) "." hmacSha256Hex(secret, base64url(payload))`. */
const ATTEMPT_TOKEN_RE = /^[A-Za-z0-9_-]{1,320}\.[0-9a-f]{64}$/;
const ATTEMPT_TOKEN_MAX_LEN = 512;
/** Shape check for a SIGNED attempt token (b64url payload + 64-hex sig). */
export function isValidAttemptToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ATTEMPT_TOKEN_MAX_LEN &&
    ATTEMPT_TOKEN_RE.test(value)
  );
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
 * Derive the server-side dedupe key — REV 5 clause 6:
 *   key = HMAC-SHA256(secret, validatedTokenBytes \0 eventName \0 scope)
 * where `validatedAttemptIdentity` is the FULL validated token
 * (base64url-payload + signature — the token already carries the bound
 * visitor/visit identity, so a separate visitor id is no longer a key input).
 * Deterministic (pure): the SAME (token, event, scope) triple always yields
 * the SAME key. Different event name OR scope → different key (per-event
 * dedupe scope preserved). Returns null (fail-open — no dedupe, event still
 * recorded) when the secret, event name, scope or validated token are
 * missing/invalid, so callers never hash junk and never log anything.
 *
 * `validatedAttemptToken` must already have passed classify/verify — never a
 * raw browser value, and never a re-mintable UUID. Two tabs → different tokens
 * (different visit binding) → different keys; same token + same event across
 * retries → same key (atomic ON CONFLICT collapse).
 */
export async function deriveDedupeKey(
  secret: string | null | undefined,
  validatedAttemptToken: unknown,
  eventName: string | null | undefined,
  scope: string | null | undefined,
): Promise<string | null> {
  if (!secret || !eventName || !scope) return null;
  if (!isValidAttemptToken(validatedAttemptToken)) return null; // malformed → not called with a key
  return hmacSha256Hex(secret, `${validatedAttemptToken}\u0000${eventName}\u0000${scope}`);
}

// ── Server-issued attempt-token helpers (owner REV 5) ──
// Issuance lives on the SERVER (the /signup SSR loader mints one token per
// page load and returns it in the page data; the client-side init re-mints via
// a server fn when the loaded token cannot bind to the tab's real identity).
// The client never mints, never computes a signature, and stores the token in
// tab-scoped sessionStorage (SIGNUP_ATTEMPT_SESSION_KEY). These helpers are
// pure + bun-importable: base64url (RFC 4648 §5, no padding) + HMAC-SHA256 via
// crypto.subtle + a constant-time-ish hex signature compare.

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 base64url WITHOUT padding — URL-safe by construction. */
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
 * fail-open; the signup loader catches and serves with no token → dedupe off).
 * The payload NEVER carries PII by construction (version + nonce + expiry +
 * binding ids only — bound ids are opaque per-visitor/per-visit UUIDs, never
 * emails/passwords/field values).
 */
export async function signSignupSessionToken(
  payload: SignupSessionTokenPayload,
): Promise<string> {
  const secret = resolveDedupeSecret();
  if (!secret) throw new Error("signup attempt-token: no server secret configured");
  const json = JSON.stringify({
    v: payload.v,
    n: payload.n,
    exp: payload.exp,
    visitorId: typeof payload.visitorId === "string" ? payload.visitorId : "",
    visitId: typeof payload.visitId === "string" ? payload.visitId : "",
  });
  const payloadB64 = toBase64Url(new TextEncoder().encode(json));
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Classify a raw attempt token against the FOUR REV 5 checks (signature,
 * expiry, event-scope is the CALLER's concern via SIGNUP_ONE_SHOT_EVENTS,
 * binding). Pure + bun-testable (nowMs and the request's resolved
 * visitor/visit are injected).
 *
 * Returns:
 *   { kind: "missing" }                    — no token present (fail_open_missing)
 *   { kind: "valid", token, payload }      — all checks pass (→ 'applied')
 *   { kind: "expired" }                    — signature+version valid but exp <= now
 *   { kind: "forged" }                     — present but signature/version/shape/
 *                                            binding failed (fail_open_forged)
 * Never throws.
 */
export type AttemptTokenVerdict =
  | { kind: "missing" }
  | { kind: "valid"; token: string; payload: SignupSessionTokenPayload }
  | { kind: "expired" }
  | { kind: "forged" };

/** Normalize a possibly-absent request identity for the binding comparison. */
function bindValue(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function classifySignupAttemptToken(
  rawToken: unknown,
  opts: { nowMs: number; visitorId?: string | null; visitId?: string | null },
): Promise<AttemptTokenVerdict> {
  if (typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return { kind: "missing" };
  }
  const raw = rawToken.trim();
  if (raw.length > ATTEMPT_TOKEN_MAX_LEN) return { kind: "forged" };
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return { kind: "forged" };
  const payloadB64 = raw.slice(0, dot);
  const sigHex = raw.slice(dot + 1);
  if (payloadB64.length > 320 || !/^[A-Za-z0-9_-]+$/.test(payloadB64)) return { kind: "forged" };
  if (!/^[0-9a-f]{64}$/.test(sigHex)) return { kind: "forged" };
  const secret = resolveDedupeSecret();
  if (!secret) return { kind: "missing" }; // no secret configured → nothing to validate
  const expected = await hmacSha256Hex(secret, payloadB64);
  if (!safeCompareHex(expected, sigHex)) return { kind: "forged" };

  let payload: unknown;
  try {
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    payload = JSON.parse(json);
  } catch {
    return { kind: "forged" };
  }
  if (typeof payload !== "object" || payload === null) return { kind: "forged" };
  const p = payload as Record<string, unknown>;
  if (p.v !== SIGNUP_ATTEMPT_VERSION) return { kind: "forged" };
  if (typeof p.n !== "string" || p.n.length === 0 || p.n.length > 128) return { kind: "forged" };
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return { kind: "forged" };
  if (p.exp <= opts.nowMs) return { kind: "expired" };
  // REV 5 clause 4 — visitor/session BINDING: signed ids must equal the request
  // identity. A token minted for a different visitor or a different tab/session
  // can never key this request's dedupe (never merge unrelated attempts).
  const signedVisitor = bindValue(typeof p.visitorId === "string" ? p.visitorId : "");
  const signedVisit = bindValue(typeof p.visitId === "string" ? p.visitId : "");
  if (signedVisitor !== bindValue(opts.visitorId) || signedVisit !== bindValue(opts.visitId)) {
    return { kind: "forged" };
  }
  return {
    kind: "valid",
    token: raw,
    payload: {
      v: p.v as typeof SIGNUP_ATTEMPT_VERSION,
      n: p.n as string,
      exp: p.exp as number,
      visitorId: signedVisitor,
      visitId: signedVisit,
    },
  };
}

/**
 * Verify a raw attempt token. Returns the payload on success, or null on ANY
 * failure — missing/oversized/not-a-string, malformed shape, bad base64url,
 * signature mismatch, wrong version, expired, or BINDING mismatch (the token's
 * signed visitorId/visitId vs the injected request identity). Never throws.
 * Fail-open contract: callers treat null as "no usable attempt token" →
 * dedupe_key NULL → the event is still recorded (byte-identical no-key path).
 * Pure + bun-testable: nowMs and the request's resolved visitor/visit are
 * injected as parameters.
 */
export async function verifySignupSessionToken(
  rawToken: unknown,
  opts: { nowMs: number; visitorId?: string | null; visitId?: string | null },
): Promise<SignupSessionTokenPayload | null> {
  const verdict = await classifySignupAttemptToken(rawToken, opts);
  return verdict.kind === "valid" ? verdict.payload : null;
}

/**
 * Resolve the request's attempt basis (REV 5 transport): the raw `attempt_token`
 * field of the telemetry/signup request BODY — never a cookie header. Absent /
 * empty / non-string → null (fail_open_missing). Present → the trimmed raw
 * token (capped at 512; a longer value can never pass the shape checks below).
 */
export function extractAttemptTokenFromBody(
  body: Record<string, unknown> | null | undefined,
): string | null {
  const raw = body?.attempt_token;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t.slice(0, ATTEMPT_TOKEN_MAX_LEN) : null;
}

/**
 * The server's ONE dedupe decision for a signup one-shot event (REV 5
 * clauses 5+6) — exactly what the intake and /api/signup diagnostic paths run.
 * Produces the dedupe_key AND the funnel_events.dedupe_status flag; every
 * fail-open path returns key: null WITH its status so callers can still record
 * the event (no suppression). Only ever called for SIGNUP_ONE_SHOT_EVENTS; the
 * caller leaves dedupe_status NULL for every other event (byte-identical).
 */
export type OneShotDedupeOutcome =
  | { status: "applied"; key: string }
  | { status: "fail_open_missing"; key: null }
  | { status: "fail_open_forged"; key: null }
  | { status: "fail_open_expired"; key: null };

export async function resolveOneShotDedupe(input: {
  secret: string | null;
  rawToken: unknown;
  nowMs: number;
  visitorId: string | null;
  visitId: string | null;
  eventName: string;
  scope?: string;
}): Promise<OneShotDedupeOutcome> {
  const verdict = await classifySignupAttemptToken(input.rawToken, {
    nowMs: input.nowMs,
    visitorId: input.visitorId,
    visitId: input.visitId,
  });
  if (verdict.kind === "valid") {
    const key = await deriveDedupeKey(
      input.secret,
      verdict.token,
      input.eventName,
      input.scope ?? SIGNUP_DEDUPE_SCOPE,
    );
    if (key) return { status: "applied", key };
    return { status: "fail_open_missing", key: null }; // no secret configured
  }
  if (verdict.kind === "expired") return { status: "fail_open_expired", key: null };
  if (verdict.kind === "forged") return { status: "fail_open_forged", key: null };
  return { status: "fail_open_missing", key: null };
}

// ── Client-side token storage + decision helpers (REV 5 clause 1) ──
// Tab-scoped sessionStorage is the ONLY transport. The client reads/gates on
// the client-readable envelope (base64-decode — NO crypto needed client-side),
// but can never forge a signature: any tampered token simply classifies
// 'forged' server-side and records without dedupe.

/** sessionStorage glue — guarded, never throws, SSR-safe. */
export function readStoredAttemptToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SIGNUP_ATTEMPT_SESSION_KEY);
  } catch {
    return null;
  }
}

/** sessionStorage glue — guarded, never throws, SSR-safe. */
export function storeAttemptToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SIGNUP_ATTEMPT_SESSION_KEY, token);
  } catch {
    /* sessionStorage blocked — token lives only for this mount (fail-open) */
  }
}

/** sessionStorage glue — guarded, never throws, SSR-safe. */
export function clearStoredAttemptToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SIGNUP_ATTEMPT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Base64url → UTF-8 (client-readable decode; throws on malformed input). */
export function base64UrlDecodeToUtf8(value: string): string {
  // Pad back to a multiple of 4 for atob() (browser) / Buffer (tests).
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.from(atob(b64), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Client-readable envelope decode: `base64url(payload) → JSON object | null`.
 * NO crypto — the signature is never checked client-side (the server is the
 * authority); this only reads exp/binding for the sessionStorage reuse rule.
 */
export function readClientTokenEnvelope(rawToken: unknown): Record<string, unknown> | null {
  if (typeof rawToken !== "string") return null;
  const dot = rawToken.indexOf(".");
  if (dot <= 0) return null;
  const b64 = rawToken.slice(0, dot);
  if (b64.length > 320 || !/^[A-Za-z0-9_-]+$/.test(b64)) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecodeToUtf8(b64));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Client-readable expiry (epoch ms) from the token envelope, or null. */
export function readClientTokenExpiry(rawToken: unknown): number | null {
  const env = readClientTokenEnvelope(rawToken);
  const exp = env?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

/** Client-readable binding fields from the token envelope (default ""). */
export function readClientTokenBinding(rawToken: unknown): {
  visitorId: string;
  visitId: string;
} {
  const env = readClientTokenEnvelope(rawToken);
  return {
    visitorId: typeof env?.visitorId === "string" ? env.visitorId : "",
    visitId: typeof env?.visitId === "string" ? env.visitId : "",
  };
}

/**
 * The client's attempt-token decision on /signup init (REV 5 clause 1) —
 * pure + unit-testable (`mint` is injected so the suite needs no server):
 *
 *   1. REUSE — stored sessionStorage token present, client-readable exp in the
 *      future, and it binds to THIS tab's visitor/visit identity. This is what
 *      preserves the token across SPA nav and ordinary reloads.
 *   2. ADOPT — no usable stored token, but the loader-supplied token binds to
 *      this tab's identity and is unexpired (first visit in a tab whose SSR
 *      request already observed the same identity).
 *   3. MINT — otherwise obtain a fresh SERVER-signed token bound to the tab's
 *      real visitor/visit ids (new tab → sessionStorage empty → independent
 *      token per tab; completion/restart → rotation).
 * Never throws; returns { token: null } when minting is unavailable (fail-open
 * → events record without dedupe).
 */
export async function resolveSignupAttemptToken(input: {
  storedToken: string | null;
  loaderToken: string | null;
  nowMs: number;
  visitorId: string;
  visitId: string;
  mint: (visitorId: string, visitId: string) => Promise<string | null>;
}): Promise<{ token: string | null; reused: boolean }> {
  const { storedToken, loaderToken, nowMs, visitorId, visitId, mint } = input;
  const binds = (raw: string): boolean => {
    const b = readClientTokenBinding(raw);
    return b.visitorId === visitorId && b.visitId === visitId;
  };
  if (storedToken) {
    const exp = readClientTokenExpiry(storedToken);
    if (exp !== null && exp > nowMs && binds(storedToken)) {
      return { token: storedToken, reused: true };
    }
  }
  if (loaderToken) {
    const exp = readClientTokenExpiry(loaderToken);
    if (exp !== null && exp > nowMs && binds(loaderToken)) {
      return { token: loaderToken, reused: false };
    }
  }
  try {
    const fresh = await mint(visitorId, visitId);
    if (fresh) return { token: fresh, reused: false };
  } catch {
    /* fall through — fail-open */
  }
  return { token: null, reused: false };
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
