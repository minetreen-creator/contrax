/**
 * Pure signup telemetry tests — `bun test` (built-in runner, zero new deps).
 *
 * Covers the four owner-required suites (PR #374 extension, ADDITION 3):
 *   (1) PATH ATTRIBUTION — source-param-first, referrer fallback, SPA nav.
 *   (2) ZERO-FORM-INTERACTION EXIT — label "view" + correct seconds_on_page.
 *   (3) DUPLICATE SUPPRESSION — same-attempt collision, cross-attempt
 *       independence, malformed-attempt fail-open.
 *   (4) NO-PII GUARANTEE — raw email/password values never appear in any
 *       payload builder output or derived key.
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
  isValidAttemptId,
  mintAttemptId,
  resolveAcquisitionPath,
  SIGNUP_ONE_SHOT_EVENTS,
  type AcquisitionBucket,
} from "./signup-telemetry";

const SECRET = "test-secret-not-really-a-secret";

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

// ── (3) DUPLICATE SUPPRESSION ─────────────────────────────────────────────

describe("deriveDedupeKey — server-safe duplicate suppression (owner gates a–d)", () => {
  test("same attempt id + same event → identical key (would collide → suppressed)", async () => {
    const a = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
    const b = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  test("DIFFERENT attempt ids → different keys (legitimate events NOT collapsed)", async () => {
    const k1 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
    const k2 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "6b29fc40-0f4b-4b9e-9c5e-1e6c9a3f2d81");
    expect(k1).not.toBe(k2);
  });

  test("different event names → different keys (per-event scoping)", async () => {
    const k1 = await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
    const k2 = await deriveDedupeKey(SECRET, "visitor-1", "signup_success", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
    expect(k1).not.toBe(k2);
  });

  test("malformed attempt id → deriveDedupeKey returns null (fail-open; key never derived)", async () => {
    expect(isValidAttemptId("not-a-uuid")).toBe(false);
    expect(isValidAttemptId("")).toBe(false);
    expect(isValidAttemptId(12345)).toBe(false);
    // The fail-open contract: a malformed id must NOT be hashed into a key.
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "not-a-uuid")).toBeNull();
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", "")).toBeNull();
    expect(await deriveDedupeKey(SECRET, "visitor-1", "signup_submit", null)).toBeNull();
    // Missing inputs also fail open (never log / never hash junk).
    expect(await deriveDedupeKey(null, "visitor-1", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f")).toBeNull();
    expect(await deriveDedupeKey(SECRET, null, "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f")).toBeNull();
  });

  test("valid UUIDv4 accepted; near-miss UUID rejected", () => {
    expect(isValidAttemptId("8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f")).toBe(true);
    expect(isValidAttemptId("8f14e45f-ceea-5cd2-b1d7-2d2a2a1c0b7f")).toBe(false); // version 5
    expect(isValidAttemptId("8f14e45f-ceea-4cd2-c1d7-2d2a2a1c0b7f")).toBe(false); // variant c
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

  test("mintAttemptId produces a valid UUIDv4 (or a safe fallback)", () => {
    const id = mintAttemptId();
    if (id.startsWith("fallback-")) {
      expect(id.length).toBeGreaterThan(10);
    } else {
      expect(isValidAttemptId(id)).toBe(true);
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

  test("derived dedupe keys never contain raw values (HMAC output, not input)", async () => {
    const key = await deriveDedupeKey(SECRET, "victim-visitor", "signup_submit", "8f14e45f-ceea-4cd2-b1d7-2d2a2a1c0b7f");
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