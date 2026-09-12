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

// ── Server-side duplicate suppression (owner gates a–d) ──
// The DB uniqueness rule: a partial unique index on funnel_events.dedupe_key
// (WHERE dedupe_key IS NOT NULL) + INSERT ... ON CONFLICT (dedupe_key) DO
// NOTHING. The key is derived SERVER-SIDE from the server secret, visitor id,
// event name and the attempt id — never the raw browser value. A 64 ms
// double-fire of the SAME attempt id collides → suppressed; a reload / fresh
// submit mints a new UUIDv4 → new key → stored (legitimate events NEVER
// collapse). Invalid/missing attempt id → no key → event still recorded.
export const SIGNUP_ONE_SHOT_EVENTS: ReadonlySet<string> = new Set([
  "signup_exit",
  "signup_abandon",
  "signup_submit",
  "signup_success",
  "signup_field_error",
  "signup_submit_error",
]);

/** Strict UUIDv4 — canonical 8-4-4-4-12 lowercase/uppercase hex, version 4,
 *  variant [89ab]. Length capped at 64 so oversized values can't be hashed. */
const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidAttemptId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && UUIDV4_RE.test(value);
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
 * \0 attemptId) hex. Deterministic (pure) — the SAME inputs always yield the
 * SAME key. Returns null (fail-open — no dedupe, event still recorded) when
 * the secret, visitor id, event name or attempt id are missing/invalid, so
 * callers never hash junk and never log anything.
 */
export async function deriveDedupeKey(
  secret: string | null | undefined,
  visitorId: string | null | undefined,
  eventName: string | null | undefined,
  attemptId: unknown,
): Promise<string | null> {
  if (!secret || !visitorId || !eventName) return null;
  if (!isValidAttemptId(attemptId)) return null; // malformed → not called with a key
  return hmacSha256Hex(secret, `${visitorId}\u0000${eventName}\u0000${attemptId}`);
}

// ── Client attempt-id minting (owner spec) ──
// One UUID per page load for exit/abandon; a fresh UUID per submit click for
// submit/success/field_error. Falls back to a non-UUID value when
// crypto.randomUUID is unavailable → the server's UUIDv4 validation fails →
// dedupe_key NULL → event recorded normally (fail-open).
export function mintAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the fallback */
  }
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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