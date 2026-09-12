/**
 * Pure unit tests for src/lib/signup-telemetry.ts (owner 09-12, PR #374).
 *
 * Sections:
 *   (1) PATH ATTRIBUTION — source param first, referrer fallback.
 *   (2) ZERO-FORM-INTERACTION EXIT — label "view" + correct seconds_on_page.
 *   (3) SERVER-ISSUED ATTEMPT TOKENS (owner REV 5) — sign/verify lifecycle
 *       (forged, expired, malformed → null fail-open), the FOUR REV 5 checks
 *       (signature / expiry / event-scope / visitor-session BINDING), the
 *       request-BODY transport (no cookie), retry-reuse (SAME token → SAME
 *       key), new-attempt rule (DIFFERENT tokens → DIFFERENT keys), key =
 *       validated-token \0 event \0 scope, and resolveOneShotDedupe's
 *       dedupe_status outcomes (applied | fail_open_missing | forged |
 *       expired) with NO suppression on any fail-open path.
 *   (4) REV 5 CLIENT DECISIONS — two simultaneous tabs (independent tokens /
 *       keys), reload preservation (same token reused), rotation after
 *       completion (fresh token after clearing), client-readable expiry +
 *       binding decode (no crypto client-side).
 *   (5) NO-PII GUARANTEE — raw email/password values never appear in any
 *       payload builder output, token payload/envelope, or derived key.
 *
 * No server runtime, no DB, no network — pure module only.
 */
import { describe, expect, test } from "bun:test";
import {
  ACQUISITION_BUCKETS,
  buildExitPayload,
  buildFieldErrorPayload,
  classifySignupAttemptToken,
  clearStoredAttemptToken,
  containsSensitiveString,
  deriveDedupeKey,
  extractAttemptTokenFromBody,
  FIELD_ERROR_FIELDS,
  isValidAttemptToken,
  mintAttemptNonce,
  readClientTokenBinding,
  readClientTokenExpiry,
  readStoredAttemptToken,
  resolveAcquisitionPath,
  resolveOneShotDedupe,
  resolveSignupAttemptToken,
  signSignupSessionToken,
  SIGNUP_ATTEMPT_MAX_AGE_S,
  SIGNUP_ATTEMPT_VERSION,
  SIGNUP_DEDUPE_SCOPE,
  SIGNUP_ONE_SHOT_EVENTS,
  storeAttemptToken,
  verifySignupSessionToken,
  type AcquisitionBucket,
  type SignupSessionTokenPayload,
} from "./signup-telemetry";

const SECRET = "test-secret-not-really-a-secret";
// Deterministic-ish token factories (payloads only — signing is async).
const NOW = 1_750_000_000_000;

/** Default binding mirrors a real tab: one visitor, one visit. */
const DEFAULT_VISITOR = "visitor-1";
const DEFAULT_VISIT = "visit-1";

async function makeToken(
  overrides: Partial<SignupSessionTokenPayload> = {},
): Promise<string> {
  return signSignupSessionToken({
    v: SIGNUP_ATTEMPT_VERSION,
    n: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    exp: NOW + SIGNUP_ATTEMPT_MAX_AGE_S * 1000,
    visitorId: DEFAULT_VISITOR,
    visitId: DEFAULT_VISIT,
    ...overrides,
  });
}

/** Valid request identity matching makeToken()'s default binding. */
const REQ = { visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT };

async function keyFor(token: string, event = "signup_submit"): Promise<string | null> {
  return deriveDedupeKey(SECRET, token, event, SIGNUP_DEDUPE_SCOPE);
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
// ── (3) SERVER-ISSUED ATTEMPT TOKENS (owner REV 5) ─────────────────────────
describe("signSignupSessionToken / verifySignupSessionToken — server-issued, signed, expiring", () => {
  test("signed token validates: payload round-trips with version + nonce + expiry + binding", async () => {
    const token = await makeToken();
    expect(isValidAttemptToken(token)).toBe(true);
    const verified = await verifySignupSessionToken(token, { nowMs: NOW, ...REQ });
    expect(verified).not.toBeNull();
    expect(verified!.v).toBe(SIGNUP_ATTEMPT_VERSION);
    expect(verified!.n).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(verified!.visitorId).toBe(DEFAULT_VISITOR);
    expect(verified!.visitId).toBe(DEFAULT_VISIT);
  });
  test("forged signature → null (signature check)", async () => {
    const token = await makeToken();
    const negated = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifySignupSessionToken(negated, { nowMs: NOW, ...REQ })).toBeNull();
  });
  test("expired token → null (expiry check)", async () => {
    const expired = await makeToken({ exp: NOW - 5000 });
    expect(await verifySignupSessionToken(expired, { nowMs: NOW, ...REQ })).toBeNull();
    // Boundary: exp === now is NOT valid (must be strictly in the future).
    const boundary = await makeToken({ exp: NOW });
    expect(await verifySignupSessionToken(boundary, { nowMs: NOW, ...REQ })).toBeNull();
  });
  test("malformed token → null (all fail-open paths)", async () => {
    expect(await verifySignupSessionToken(null, { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken(undefined, { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken("", { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken(12345, { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken("no-dot-here", { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken(".sigonly", { nowMs: NOW, ...REQ })).toBeNull();
    expect(await verifySignupSessionToken("payload.", { nowMs: NOW, ...REQ })).toBeNull();
    // Bad base64url alphabet ('=' padding / '+' are invalid in our token).
    expect(await verifySignupSessionToken("abc=def.1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd", { nowMs: NOW, ...REQ })).toBeNull();
    // Non-hex / wrong-length signature.
    expect(await verifySignupSessionToken("abc.zz", { nowMs: NOW, ...REQ })).toBeNull();
    // Wrong version inside a correctly-signed payload.
    const wrongVersion = await signSignupSessionToken({ v: 2 as never, n: "x", exp: NOW + 1000, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT });
    expect(await verifySignupSessionToken(wrongVersion, { nowMs: NOW, ...REQ })).toBeNull();
    // Oversized (>512 chars) → null without hashing.
    expect(await verifySignupSessionToken("a".repeat(600), { nowMs: NOW, ...REQ })).toBeNull();
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
  test("attempt token rides the REQUEST BODY (never a cookie header) — absent → null fail-open; valid → raw token returns; negated/expired never pass", async () => {
    const token = await makeToken();
    // Absent body field → null (fail-open).
    expect(extractAttemptTokenFromBody(null)).toBeNull();
    expect(extractAttemptTokenFromBody(undefined)).toBeNull();
    expect(extractAttemptTokenFromBody({})).toBeNull();
    expect(extractAttemptTokenFromBody({ attempt_token: "" })).toBeNull();
    expect(extractAttemptTokenFromBody({ attempt_token: "   " })).toBeNull();
    expect(extractAttemptTokenFromBody({ attempt_token: 12345 })).toBeNull();
    // Present + valid → the RAW token comes back (it IS the attempt basis).
    expect(extractAttemptTokenFromBody({ attempt_token: token })).toBe(token);
    // Negated → raw returns but classification fails (forged): an
    // unsigned/forged value never passes.
    const negated = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(extractAttemptTokenFromBody({ attempt_token: negated })).toBe(negated);
    expect(await classifySignupAttemptToken(negated, { nowMs: NOW, ...REQ })).toEqual({ kind: "forged" });
    const expired = await makeToken({ exp: NOW - 5000 });
    expect(await classifySignupAttemptToken(expired, { nowMs: NOW, ...REQ })).toEqual({ kind: "expired" });
  });
});
describe("REV 5 four server checks — signature, expiry, event scope, visitor/session BINDING", () => {
  test("classify: missing → {kind:'missing'}", async () => {
    expect(await classifySignupAttemptToken(null, { nowMs: NOW, ...REQ })).toEqual({ kind: "missing" });
    expect(await classifySignupAttemptToken(undefined, { nowMs: NOW, ...REQ })).toEqual({ kind: "missing" });
    expect(await classifySignupAttemptToken("", { nowMs: NOW, ...REQ })).toEqual({ kind: "missing" });
    expect(await classifySignupAttemptToken("   ", { nowMs: NOW, ...REQ })).toEqual({ kind: "missing" });
  });
  test("classify: tampered signature → {kind:'forged'}", async () => {
    const token = await makeToken();
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    const v = await classifySignupAttemptToken(tampered, { nowMs: NOW, ...REQ });
    expect(v.kind).toBe("forged");
  });
  test("classify: expired (signature valid but exp <= now) → {kind:'expired'}", async () => {
    const expired = await makeToken({ exp: NOW - 1 });
    const v = await classifySignupAttemptToken(expired, { nowMs: NOW, ...REQ });
    expect(v.kind).toBe("expired");
  });
  test("classify: valid + binding match → {kind:'valid'} with the raw token", async () => {
    const token = await makeToken();
    const v = await classifySignupAttemptToken(token, { nowMs: NOW, ...REQ });
    expect(v).toEqual({ kind: "valid", token, payload: expect.objectContaining({ v: 1, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT }) });
  });
  test("BINDING: token minted for a DIFFERENT visitor → forged (never merge unrelated attempts)", async () => {
    const token = await makeToken({ visitorId: "visitor-999" });
    const v = await classifySignupAttemptToken(token, { nowMs: NOW, ...REQ });
    expect(v.kind).toBe("forged");
    expect(await verifySignupSessionToken(token, { nowMs: NOW, ...REQ })).toBeNull();
  });
  test("BINDING: token minted for a DIFFERENT visit (another tab) → forged for this request", async () => {
    const token = await makeToken({ visitId: "visit-999" });
    const v = await classifySignupAttemptToken(token, { nowMs: NOW, ...REQ });
    expect(v.kind).toBe("forged");
  });
  test("BINDING: same visitor + same visit → valid (the reload/retry happy path)", async () => {
    const token = await makeToken();
    expect((await classifySignupAttemptToken(token, { nowMs: NOW, ...REQ })).kind).toBe("valid");
    // Also valid when the request identity matches the signed binding exactly.
    const v = await verifySignupSessionToken(token, { nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT });
    expect(v).not.toBeNull();
  });
  test("EVENT SCOPE: only the six signup one-shot events are dedupe-scoped; anything else is untouched (server leaves the flag NULL at the call site)", () => {
    expect([...SIGNUP_ONE_SHOT_EVENTS].sort()).toEqual(
      ["signup_abandon", "signup_exit", "signup_field_error", "signup_submit", "signup_submit_error", "signup_success"].sort(),
    );
    for (const ev of ["signup_view", "radar_completed", "hero_cta_click", "score_submit", "signup_viewed_from_radar"]) {
      expect(SIGNUP_ONE_SHOT_EVENTS.has(ev)).toBe(false);
    }
  });
});
describe("resolveOneShotDedupe — dedupe_status outcomes (REV 5 clause 5), no suppression", () => {
  test("valid token + secret → {status:'applied', key} (insert attempted with ON CONFLICT DO NOTHING)", async () => {
    const token = await makeToken();
    const out = await resolveOneShotDedupe({
      secret: SECRET, rawToken: token, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_submit",
    });
    expect(out.status).toBe("applied");
    expect((out as { key: string }).key).toMatch(/^[0-9a-f]{64}$/);
  });
  test("missing token → {status:'fail_open_missing', key:null} AND the event still records (no suppression)", async () => {
    const out = await resolveOneShotDedupe({
      secret: SECRET, rawToken: null, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_submit",
    });
    expect(out).toEqual({ status: "fail_open_missing", key: null });
  });
  test("forged (tampered signature) → {status:'fail_open_forged', key:null}, event still records", async () => {
    const token = await makeToken();
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    const out = await resolveOneShotDedupe({
      secret: SECRET, rawToken: tampered, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_submit",
    });
    expect(out).toEqual({ status: "fail_open_forged", key: null });
  });
  test("forged (wrong binding) → {status:'fail_open_forged', key:null}, event still records", async () => {
    const token = await makeToken({ visitorId: "attacker-visitor" });
    const out = await resolveOneShotDedupe({
      secret: SECRET, rawToken: token, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_success",
    });
    expect(out).toEqual({ status: "fail_open_forged", key: null });
  });
  test("expired → {status:'fail_open_expired', key:null}, event still records", async () => {
    const expired = await makeToken({ exp: NOW - 1000 });
    const out = await resolveOneShotDedupe({
      secret: SECRET, rawToken: expired, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_abandon",
    });
    expect(out).toEqual({ status: "fail_open_expired", key: null });
  });
  test("no secret configured → fail open (events still record with key null)", async () => {
    const token = await makeToken();
    const out = await resolveOneShotDedupe({
      secret: null, rawToken: token, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, eventName: "signup_submit",
    });
    expect(out.status).toBe("fail_open_missing");
    expect(out.key).toBeNull();
  });
});
describe("deriveDedupeKey — REV 5 clause 6: key = validated-token \\0 event \\0 scope", () => {
  test("SAME token reused across retries → IDENTICAL key (double-fire collapses)", async () => {
    const token = await makeToken();
    const a = await keyFor(token);
    const b = await keyFor(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
  test("DIFFERENT tokens (two tabs / a new attempt) → DIFFERENT keys (legitimate events NEVER collapse)", async () => {
    const t1 = await makeToken({ n: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const t2 = await makeToken({ n: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(t1).not.toBe(t2);
    expect(await keyFor(t1)).not.toBe(await keyFor(t2));
  });
  test("different event names → different keys (per-event scoping)", async () => {
    const token = await makeToken();
    expect(await keyFor(token, "signup_submit")).not.toBe(await keyFor(token, "signup_success"));
  });
  test("different SCOPE const → different key (the scope is part of the key input)", async () => {
    const token = await makeToken();
    const k1 = await deriveDedupeKey(SECRET, token, "signup_submit", "signup_oneshot");
    const k2 = await deriveDedupeKey(SECRET, token, "signup_submit", "other_scope");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBeNull();
  });
  test("malformed/missing token → deriveDedupeKey returns null (fail-open; key never derived)", async () => {
    expect(await deriveDedupeKey(SECRET, "not-a-token", "signup_submit", SIGNUP_DEDUPE_SCOPE)).toBeNull();
    expect(await deriveDedupeKey(SECRET, "", "signup_submit", SIGNUP_DEDUPE_SCOPE)).toBeNull();
    expect(await deriveDedupeKey(SECRET, null, "signup_submit", SIGNUP_DEDUPE_SCOPE)).toBeNull();
    // Missing inputs also fail open (never log / never hash junk).
    expect(await deriveDedupeKey(SECRET, "abc.def", "", SIGNUP_DEDUPE_SCOPE)).toBeNull();
    expect(await deriveDedupeKey(SECRET, "abc.def", "signup_submit", null)).toBeNull();
    expect(await deriveDedupeKey(null, "abc.def", "signup_submit", SIGNUP_DEDUPE_SCOPE)).toBeNull();
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
// ── (4) REV 5 CLIENT DECISIONS ───────────────────────────────────────────
describe("client attempt-token decisions — tab-scoped sessionStorage (REV 5 clause 1)", () => {
  const noMint = () => Promise.resolve(null);
  const mintSpy = (tokens: string[]) => async (_visitorId: string, _visitId: string) => {
    const t = tokens.shift() ?? null;
    return t;
  };
  test("TWO SIMULTANEOUS TABS — independent tokens (independent sessionStorage) → DIFFERENT keys, both events recorded", async () => {
    // Tab A and Tab B each start with EMPTY sessionStorage and mint their own
    // server-signed token bound to their own tab identity (same visitor, two
    // different visits — sessionStorage is per-tab).
    const tabA = await makeToken({ n: "aaaa".padEnd(32, "a"), visitId: "visit-A" });
    const tabB = await makeToken({ n: "bbbb".padEnd(32, "b"), visitId: "visit-B" });
    expect(tabA).not.toBe(tabB);
    const ka = await keyFor(tabA);
    const kb = await keyFor(tabB);
    expect(ka).not.toBe(kb); // never collapse across tabs
    // Both classify valid for their OWN request identity → both may record.
    const va = await classifySignupAttemptToken(tabA, { nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: "visit-A" });
    const vb = await classifySignupAttemptToken(tabB, { nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: "visit-B" });
    expect(va.kind).toBe("valid");
    expect(vb.kind).toBe("valid");
  });
  test("RELOAD PRESERVATION — the sessionStorage reuse rule: init with an existing unexpired token reuses it (no new mint, same key)", async () => {
    const stored = await makeToken();
    let minted = 0;
    const res = await resolveSignupAttemptToken({
      storedToken: stored,
      loaderToken: null,
      nowMs: NOW,
      visitorId: DEFAULT_VISITOR,
      visitId: DEFAULT_VISIT,
      mint: async () => { minted += 1; return "never-used"; },
    });
    expect(res).toEqual({ token: stored, reused: true });
    expect(minted).toBe(0); // the reload did NOT obtain a fresh token
    // Same key before/after the "reload" — the retry/double-fire collapses.
    expect(await keyFor(res.token!)).toBe(await keyFor(stored));
  });
  test("ROTATION AFTER COMPLETION — clearing the token then minting fresh → DIFFERENT token and key", async () => {
    const first = await makeToken({ n: "aaaa".padEnd(32, "a") });
    const res1 = await resolveSignupAttemptToken({
      storedToken: first, loaderToken: null, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT, mint: noMint,
    });
    expect(res1.token).toBe(first);
    // Completion: clearStoredAttemptToken() removes it (sessionStorage.removeItem)…
    const key1 = await keyFor(first);
    // …then the next page load mints a FRESH token → different key.
    const second = await makeToken({ n: "bbbb".padEnd(32, "b") });
    expect(second).not.toBe(first);
    expect(await keyFor(second)).not.toBe(key1);
    // And the client decision with no stored token falls through to the mint.
    const res2 = await resolveSignupAttemptToken({
      storedToken: null, loaderToken: null, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT,
      mint: mintSpy([second]),
    });
    expect(res2).toEqual({ token: second, reused: false });
  });
  test("loader-supplied token is adopted on a first visit when it binds to the tab identity", async () => {
    const loaderToken = await makeToken();
    let minted = 0;
    const res = await resolveSignupAttemptToken({
      storedToken: null,
      loaderToken,
      nowMs: NOW,
      visitorId: DEFAULT_VISITOR,
      visitId: DEFAULT_VISIT,
      mint: async () => { minted += 1; return null; },
    });
    expect(res).toEqual({ token: loaderToken, reused: false });
    expect(minted).toBe(0);
  });
  test("loader token that does NOT bind → fresh server mint bound to the tab's real identity", async () => {
    const loaderToken = await makeToken({ visitorId: "old-cookie-visitor" }); // SSR could only see the old cookie
    const fresh = await makeToken({ n: "cccc".padEnd(32, "c") });
    const res = await resolveSignupAttemptToken({
      storedToken: null,
      loaderToken,
      nowMs: NOW,
      visitorId: DEFAULT_VISITOR,
      visitId: DEFAULT_VISIT,
      mint: mintSpy([fresh]),
    });
    expect(res).toEqual({ token: fresh, reused: false });
    expect(await classifySignupAttemptToken(fresh, { nowMs: NOW, ...REQ })).toEqual({ kind: "valid", token: fresh, payload: expect.anything() });
  });
  test("expired stored token is NOT reused → fresh mint (client-readable exp gate)", async () => {
    const stale = await makeToken({ exp: NOW - 10_000 });
    const fresh = await makeToken({ n: "dddd".padEnd(32, "d") });
    const res = await resolveSignupAttemptToken({
      storedToken: stale, loaderToken: null, nowMs: NOW, visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT,
      mint: mintSpy([fresh]),
    });
    expect(res).toEqual({ token: fresh, reused: false });
  });
  test("client-readable envelope decode needs NO crypto: exp + binding are readable from the base64 payload", async () => {
    const token = await makeToken({ exp: NOW + 123_456 });
    expect(readClientTokenExpiry(token)).toBe(NOW + 123_456);
    expect(readClientTokenBinding(token)).toEqual({ visitorId: DEFAULT_VISITOR, visitId: DEFAULT_VISIT });
    expect(readClientTokenExpiry("garbage")).toBeNull();
    expect(readClientTokenBinding(null)).toEqual({ visitorId: "", visitId: "" });
  });
  test("sessionStorage glue is no-ops outside a browser (SSR safety)", () => {
    expect(readStoredAttemptToken()).toBeNull();
    storeAttemptToken("x"); // must not throw
    clearStoredAttemptToken(); // must not throw
  });
});
// ── (5) NO-PII GUARANTEE ──────────────────────────────────────────────────
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
  test("attempt-token payload can NEVER contain email/password (v/n/exp + opaque binding ids only, server-minted)", async () => {
    const token = await makeToken({ n: mintAttemptNonce() });
    // The full token string (payload + signature) contains no raw values.
    expect(containsSensitiveString(token, SENSITIVE)).toBe(false);
    // The visible first segment even decodes to nothing but the payload fields.
    const payloadB64 = token.slice(0, token.indexOf("."));
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    expect(containsSensitiveString(decoded, SENSITIVE)).toBe(false);
    expect(decoded).toMatch(/^\{[^}]*"v":1[^}]*\}$/);
    const env = JSON.parse(decoded);
    expect(Object.keys(env).sort()).toEqual(["exp", "n", "v", "visitId", "visitorId"]);
  });
  test("derived dedupe keys never contain raw values (HMAC output, not input)", async () => {
    // Even a visitor id that LOOKS like the email must not show up in the key.
    const key = await deriveDedupeKey(SECRET, await makeToken({ visitorId: FAKE_EMAIL }), "signup_submit", SIGNUP_DEDUPE_SCOPE);
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