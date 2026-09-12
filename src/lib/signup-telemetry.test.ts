/**
 * Pure signup telemetry tests — `bun test` (built-in runner, zero new deps).
 *
 * Covers the four owner-required suites (PR #374 extension, ADDITION 3) plus
 * the server-issued attempt-token suite (owner REV 4 gate 1 correction):
 *   (1) PATH ATTRIBUTION — source-param-first, referrer fallback, SPA nav.
 *   (2) ZERO-FORM-INTERACTION EXIT — label "view" + correct seconds_on_page.
 *   (3) SERVER-ISSUED ATTEMPT TOKENS — sign/verify lifecycle (forged, expired,
 *       malformed → null fail-open), retry-reuse (SAME token → SAME dedupe
 *       key), new-attempt rule (DIFFERENT tokens → DIFFERENT keys), and the
 *       cookie-header read path used by /api/event + /api/signup.
 *   (4) NO-PII GUARANTEE — raw email/password values never appear in any
 *       payload builder output, token payload, or derived key.
 *
 * No server runtime, no DB, no network — pure module only.
 */
import { describe, expect, test } from "bun:test";
import {
  ACQUISITION_BUCKETS,
  buildExitPayload,
  buildFieldErrorPayload,
  containsSensitiveString,
  deriveDedupeKey,
  FIELD_ERROR_FIELDS,
  isValidAttemptToken,
  mintAttemptNonce,
  readValidatedAttemptToken,
  resolveAcquisitionPath,
  signSignupSessionToken,
  SIGNUP_ATTEMPT_COOKIE,
  SIGNUP_ATTEMPT_MAX_AGE_S,
  SIGNUP_ATTEMPT_VERSION,
  SIGNUP_ONE_SHOT_EVENTS,
  verifySignupSessionToken,
  type AcquisitionBucket,
  type SignupSessionTokenPayload,
} from "./signup-telemetry";

const SECRET = "test-secret-not-really-a-secret";

// Deterministic-ish token factories (payloads only — signing is async).
const NOW = 1_750_000_000_000;
async function makeToken(overrides: Partial<SignupSessionTokenPayload> = {}): Promise<string> {
  return signSignupSessionToken({
    v: SIGNUP_ATTEMPT_VERSION,
    n: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    exp: NOW + SIGNUP_ATTEMPT_MAX_AGE_S * 1000,
    ...overrides,
  });
}

// ── (1) PATH ATTRIBUTION ──────────────────────────────────────────────────

describe("resolveAcquisitionPath — source param first, referrer fallback", () => {
  test("source=radar_results_cta wins over a facebook referrer", () => {
    expect(resolveAcquisitionPath("radar_results_cta", "https://www.facebook.com/")).toBe("radar");
  });

  test("source absent + SPA nav (empty referrer) → internal_other", () => {
    expect(resolveAcquisitionPath(undefined, "")).toBe("internal_other");
    expect(resolveAcquisitionPath(undefined, null)).toBe("internal_other");
  });

  test("source absent + referrer=/radar fallback works (same-site)", () => {
    expect(resolveAcquisitionPath(undefined, "https://www.contrax.company/radar")).toBe("radar");
  });

  test("cold external referrer maps external", () => {
    expect(resolveAcquisitionPath(undefined, "https://www.google.com/search?q=gov+contracts")).toBe("external");
    expect(resolveAcquisitionPath(undefined, "https://www.facebook.com/")).toBe("external");
  });

  test("every allowlisted source maps to the right bucket", () => {
    const cases: [string, AcquisitionBucket][] = [
      ["radar", "radar"],
      ["radar_results_unlock", "radar"],
      ["radar_results_cta", "radar"],
      ["autopsy", "autopsy"],
      ["closing_soon", "home"],
      ["incumbent", "awards"],
    ];
    for (const [src, bucket] of cases) {
      expect(resolveAcquisitionPath(src, "https://www.facebook.com/")).toBe(bucket);
    }
  });

  test("referrer path prefixes map to their buckets on same-site referrers", () => {
    expect(resolveAcquisitionPath(undefined, "https://www.contrax.company/autopsy/42")).toBe("autopsy");
    expect(resolveAcquisitionPath(undefined, "https://www.contrax.company/bid-scout")).toBe("bid_scout");
    expect(resolveAcquisitionPath(undefined, "https://www.contrax.company/awards")).toBe("awards");
    expect(resolveAcquisitionPath(undefined, "https://www.contrax.company/")).toBe("home");
  });

  test("malformed referrer → internal_other (identical to prior behavior)", () => {
    expect(resolveAcquisitionPath(undefined, "not a url:::")).toBe("internal_other");
  });

  test("unknown source param is ignored → referrer fallback applies", () => {
    expect(resolveAcquisitionPath("hax", "https://www.contrax.company/radar")).toBe("radar");
    expect(resolveAcquisitionPath("hax", undefined)).toBe("internal_other");
  });
});

// ── (2) ZERO-FORM-INTERACTION EXIT ─────────────────────────────────────────

describe("buildExitPayload — zero-form-interaction exit (was producing 0 rows)", () => {
  test("formStarted=false yields label 'view' with correct seconds_on_page", () => {
    const p = buildExitPayload({ secondsOnPage: 4.7, formStarted: false, from: "radar" });
    expect(p.label).toBe("view");
    expect(p.seconds_on_page).toBe(5); // rounded
    expect(p.from).toBe("radar");
  });

  test("formStarted=true yields label 'form_started'", () => {
    const p = buildExitPayload({ secondsOnPage: 12, formStarted: true, from: "external" });
    expect(p.label).toBe("form_started");
    expect(p.seconds_on_page).toBe(12);
  });

  test("negative / sub-second dwell clamps to >= 0", () => {
    expect(buildExitPayload({ secondsOnPage: -3, formStarted: false, from: "home" }).seconds_on_page).toBe(0);
    expect(buildExitPayload({ secondsOnPage: 0.4, formStarted: false, from: "home" }).seconds_on_page).toBe(0);
  });
});

// ── (3) SERVER-ISSUED ATTEMPT TOKENS (owner REV 4 gate 1) ─────────────────

describe("signSignupSessionToken / verifySignupSessionToken — server-issued, signed, expiring", () => {
  test("signed token validates: payload round-trips with version + nonce + expiry", async () => {
    const token = await makeToken();
    expect(isValidAttemptToken(token)).toBe(true);
    const verified = await verifySignupSessionToken(token, { nowMs: NOW });
    expect(verified).not.toBeNull();
    expect(verified!.v).toBe(SIGNUP_ATTEMPT_VERSION);
    expect(verified!.n).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(verified!.exp).toBe(NOW + SIGNUP_ATTEMPT_MAX_AGE_S * 1000);
  });

  test("forged signature → null (signature check)", async () => {
    const token = await makeToken();
    // Flip one char in the signature half — payload bytes untouched.
    const dot = token.indexOf(".");
    const forged = token.slice(0, dot + 1) + (token.slice(dot + 1)[0] === "a" ? "b" : "a") + token.slice(dot + 2);
    expect(forged).not.toBe(token);
    expect(await verifySignupSessionToken(forged, { nowMs: NOW })).toBeNull();
  });

  test("expired token → null (expiry check)", async () => {
    const token = await makeToken({ exp: NOW - 1000 }); // already past
    expect(await verifySignupSessionToken(token, { nowMs: NOW })).toBeNull();
    // Boundary: exp === now is NOT valid (must be strictly in the future).
    const boundary = await makeToken({ exp: NOW });
    expect(await verifySignupSessionToken(boundary, { nowMs: NOW })).toBeNull();
  });

  test("malformed token → null (all fail-open paths)", async () => {
    expect(await verifySignupSessionToken(null, { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken(undefined, { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken("", { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken(12345, { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken("no-dot-here", { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken(".sigonly", { nowMs: NOW })).toBeNull();
    expect(await verifySignupSessionToken("payload.", { nowMs: NOW })).toBeNull();
    // Bad base64url alphabet ('=' padding / '+' are invalid in our token).
    expect(await verifySignupSessionToken("abc=def.1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd", { nowMs: NOW })).toBeNull();
    // Non-hex / wrong-length signature.
    expect(await verifySignupSessionToken("abc.zz", { nowMs: NOW })).toBeNull();
    // Wrong version inside a correctly-signed payload.
    const wrongVersion = await signSignupSessionToken({ v: 2 as never, n: "x", exp: NOW + 1000 });
    expect(await verifySignupSessionToken(wrongVersion, { nowMs: NOW })).toBeNull();
    // Oversized (>521 chars) → null without hashing.
    expect(await verifySignupSessionToken("a".repeat(600), { nowMs: NOW })).toBeNull();
  });

  test("isValidAttemptToken shape checks", async () => {
    const token = await makeToken();
    expect(isValidAttemptToken(token)).toBe(true);
    expect(isValidAttemptToken("")).toBe(false);
    expect(isValidAttemptToken(12345)).toBe(false);
    expect(isValidAttemptToken("not-a-token")).toBe(false);
    expect(isValidAttemptToken("abc.zz")).toBe(false);
    expect(isValidAttemptToken(token.slice(0, -1) + "g")).toBe(false); // bad hex char
  });

  test("mintAttemptNonce produces unique 32-char hex server nonces", () => {
    const a = mintAttemptNonce();
    const b = mintAttemptNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  test("readValidatedAttemptToken — cookie-header read used by /api/event + /api/signup", async () => {
    const token = await makeToken();
    // Absent cookie header → null (fail-open).
    expect(await readValidatedAttemptToken(null, { nowMs: NOW })).toBeNull();
    expect(await readValidatedAttemptToken(undefined, { nowMs: NOW })).toBeNull();
    expect(await readValidatedAttemptToken("other_cookie=1", { nowMs: NOW })).toBeNull();
    // Present + valid → the RAW token comes back (it IS the attempt basis).
    const header = `contrax_vid=abc; ${SIGNUP_ATTEMPT_COOKIE}=${token}; other=2`;
    expect(await readValidatedAttemptToken(header, { nowMs: NOW })).toBe(token);
    // Negated → null: an unsigned/forged/expired value never passes.
    const negated = `contrax_vid=abc; ${SIGNUP_ATTEMPT_COOKIE}=${token.slice(0, -1)}x; other=2`;
    expect(await readValidatedAttemptToken(negated, { nowMs: NOW })).toBeNull();
    const expired = await makeToken({ exp: NOW - 5000 });
    expect(await readValidatedAttemptToken(`${SIGNUP_ATTEMPT_COOKIE}=${expired}`, { nowMs: NOW })).toBeNull();
  });
});

describe("deriveDedupeKey — same token reuse (retry-reuse), different tokens (new-attempt rule)", () => {
  test("SAME token reused across retries → IDENTICAL key (double-fire collapses)", async () => {
    const token = await makeToken();
    const a = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", token);
    const b = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  test("DIFFERENT tokens (new page load mints a new token) → DIFFERENT keys (legitimate events NEVER collapse)", async () => {
    const t1 = await makeToken({ n: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const t2 = await makeToken({ n: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(t1).not.toBe(t2);
    const k1 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", t1);
    const k2 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", t2);
    expect(k1).not.toBe(k2);
  });

  test("different event names → different keys (per-event scoping)", async () => {
    const token = await makeToken();
    const k1 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", token);
    const k2 = await deriveDedupeKey(SECRET, "visitor-1", "signup_success", token);
    expect(k1).not.toBe(k2);
  });

  test("malformed/missing token → deriveDedupeKey returns null (fail-open; key never derived)", async () => {
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "not-a-token")).toBeNull();
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "")).toBeNull();
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", null)).toBeNull();
    // Missing inputs also fail open (never log / never hash junk).
    expect(await deriveDedupeKey(SECRET, null, "signup_submit", "abc.def")).toBeNull();
    expect(await deriveDedupeKey(null, "visitor-1", "signup_submit", "abc.def")).toBeNull();
  });

  test("the one-shot family covers exactly the six signup events", () => {
    for (const ev of ["signup_exit", "signup_abandon", "signup_submit", "signup_success", "signup_field_error", "signup_submit_error"]) {
      expect(SIGNUP_ONE_SHOT_EVENTS.has(ev)).toBe(true);
    }
    // Everything else stays out — dedupe_key NULL, behavior byte-identical.
    for (const ev of ["signup_view", "radar_completed", "hero_cta_click", "score_submit"]) {
      expect(SIGNUP_ONE_SHOT_EVENTS.has(ev)).toBe(false);
    }
  });
});

// ── (4) NO-PII GUARANTEE ──────────────────────────────────────────────────

describe("no-PII guarantee — raw email/password values never enter analytics", () => {
  const FAKE_EMAIL = "victim@example.com";
  const FAKE_PASSWORD = "s3cret-p@ssw0rd-137";
  const SENSITIVE = [FAKE_EMAIL, FAKE_PASSWORD, "victim"];

  test("buildExitPayload carries no email/password/field values", () => {
    const payload = JSON.stringify(
      buildExitPayload({ secondsOnPage: 9, formStarted: false, from: "radar" }),
    );
    expect(containsSensitiveString(payload, SENSITIVE)).toBe(false);
  });

  test("buildFieldErrorPayload only ever carries allow-listed field names + reason text", () => {
    // Feed the actual VALUES the user typed in — the builder must reject them.
    const payload = buildFieldErrorPayload(FAKE_EMAIL, `Password must be at least 8 characters.`);
    expect(containsSensitiveString(payload, SENSITIVE)).toBe(false);
    expect(FIELD_ERROR_FIELDS).toContain(payload.field);
    // Non-allow-listed field input coerces to "multiple" — never the raw value.
    const coerced = buildFieldErrorPayload(FAKE_PASSWORD, "Please enter a valid email address.");
    expect(coerced.field).toBe("multiple");
    expect(containsSensitiveString(coerced, SENSITIVE)).toBe(false);
  });

  test("attempt-token payload can NEVER contain email/password (v/n/exp only, server-minted)", async () => {
    const token = await makeToken({ n: mintAttemptNonce() });
    // The full token string (payload + signature) contains no raw values.
    expect(containsSensitiveString(token, SENSITIVE)).toBe(false);
    // The visible first segment even decodes to nothing but {v,n,exp}.
    const payloadB64 = token.slice(0, token.indexOf("."));
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    expect(containsSensitiveString(decoded, SENSITIVE)).toBe(false);
    expect(decoded).toMatch(/^\{[^}]*"v":1[^}]*\}$/);
  });

  test("derived dedupe keys never contain raw values (HMAC output, not input)", async () => {
    // Even a visitor id that LOOKS like the email must not show up in the key.
    const token = await makeToken();
    const key = await deriveDedupeKey(SECRET, FAKE_EMAIL, "signup_submit", token);
    expect(key).not.toBeNull();
    expect(containsSensitiveString(key!, SENSITIVE)).toBe(false);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("redaction guard is a real detector (sanity check)", () => {
    expect(containsSensitiveString(`email ${FAKE_EMAIL} here`, SENSITIVE)).toBe(true);
    expect(containsSensitiveString("clean payload", SENSITIVE)).toBe(false);
    expect(containsSensitiveString(null, SENSITIVE)).toBe(false);
  });

  test("bucket vocabulary contains no personal data by construction", () => {
    expect(containsSensitiveString(ACQUISITION_BUCKETS.join(","), SENSITIVE)).toBe(false);
  });
});