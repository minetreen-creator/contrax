/**
 * RADAR CONVERSION SPRINT PR2 (owner 2026-09-07) — signed anonymous handoff.
 *
 * Server-only module (`.server.ts` suffix: never imported by client bundles —
 * see the tanstack-start-server-imports skill). HMAC-signs the anonymous
 * Radar scan state so /signup can restore the SAME scan after account creation
 * without trusting (or re-running) client data, and without PII/email in URLs.
 *
 * Payload fields (all non-PII): v visitor_id, t trade, c cert, s state,
 * z sizePref, m locked match ids, k scannedAt epoch ms.
 */
import crypto from "node:crypto";

const COOKIE = "contrax_radar_handoff";
// Owner gate: 24h window — cookie Max-Age matches the scannedAt validity window.
const MAX_AGE_S = 24 * 60 * 60; // 24 hours
const MAX_AGE_MS = MAX_AGE_S * 1000;
// Owner gate #7: small clock-skew tolerance so a marginally-future scannedAt
// from server/client clock slop still verifies; anything beyond is rejected.
const ALLOWED_SKEW_MS = 30_000;

export interface RadarHandoffPayload {
  v: string;
  t: string;
  c: string;
  s: string;
  z: string;
  m: number[];
  k: number;
}

function getRadarHandoffSecret(): string {
  const secret = process.env.RADAR_HANDOFF_SECRET
  if (!secret) {
    throw new Error("RADAR_HANDOFF_SECRET is required")
  }
  return secret
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Serialize + HMAC-sign a payload → cookie value `body.sig`. The secret
 *  getter THROWS when RADAR_HANDOFF_SECRET is unset (loud config failure);
 *  the radar.tsx mint caller wraps this in try/catch, so a missing secret
 *  never breaks the scan. Pure. Caller only calls setCookie with a real
 *  non-empty string. */
export function signRadarHandoff(p: RadarHandoffPayload): string {
  const s = getRadarHandoffSecret();
  const body = b64url(Buffer.from(JSON.stringify(p), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", s).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify a cookie value → payload, or null on ANY failure (fail-closed).
 *  Pure — covers EVERY restore path: after signature verification succeeds,
 *  the `k` (scannedAt) field must be present, > 0, and within the 24h window;
 *  expired/unverifiable → null, which the signup reader treats as absent. */
export function verifyRadarHandoff(raw: string | null | undefined): RadarHandoffPayload | null {
  try {
    const s = getRadarHandoffSecret(); // THROWS if unset — the try/catch converts it to null (fail-closed)
    if (!raw || typeof raw !== "string") return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expect = b64url(crypto.createHmac("sha256", s).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64url(body).toString("utf8")) as Partial<RadarHandoffPayload>;
    if (!p || typeof p.v !== "string" || !p.v) return null;
    // Sanitize + bound every field so a valid signature can never carry junk.
    const k = typeof p.k === "number" && Number.isFinite(p.k) ? p.k : 0;
    // Owner gate: short expiration — k must be present, within 24h of now,
    // and not from the future (beyond a small clock-skew tolerance).
    const now = Date.now();
    if (k <= 0 || k > now + ALLOWED_SKEW_MS || now - k > MAX_AGE_MS) return null;
    return {
      v: p.v.slice(0, 64),
      t: typeof p.t === "string" ? p.t.slice(0, 120) : "",
      c: typeof p.c === "string" ? p.c.slice(0, 24) : "sb",
      s: typeof p.s === "string" ? p.s.slice(0, 4) : "",
      z: typeof p.z === "string" ? p.z.slice(0, 24) : "any",
      m: Array.isArray(p.m)
        ? p.m.filter((n) => Number.isInteger(n) && (n as number) > 0).slice(0, 25).map(Number)
        : [],
      k,
    };
  } catch (err) {
    // Fail-closed unchanged: ANY failure → null. Loud ONLY on the missing-secret
    // config case (owner 09-07) so a dropped Vercel env var can't silently
    // disable the restore path. Constant string only — never the secret value,
    // never the payload/cookie, never PII, never err.stack.
    if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
      console.error("[radar-handoff] restore unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
    }
    return null;
  }
}

export const RADAR_HANDOFF_COOKIE = COOKIE;
export const RADAR_HANDOFF_MAX_AGE_S = MAX_AGE_S;

/**
 * RADAR INCUMBENT-INTEL TICKET — OWNER 09-16 (Radar scan-latency fix, order #1).
 *
 * The scan used to fetch FPDS incumbent intel for every ranked match INSIDE the
 * synchronous path (up to 5 sequential, rate-limited USAspending lookups ⇒ the
 * 7.6–15.8 s scans that crossed the 15 s client cap). Enrichment now happens
 * lazily, after the results render, one opportunity at a time, through the
 * `getRadarMatchIntel` server fn.
 *
 * That moves a REVENUE BOUNDARY with it: the scan used to strip the paywalled
 * previous-winner/award-price data from every match past the free 3 before it
 * ever left the server ("we must NOT ship the paywalled ... data for the gated
 * (3rd+) matches to the client" — radar.tsx). A lazy endpoint keyed by bid id
 * must enforce the SAME rule itself, and it cannot trust the client's claim
 * about which match it is looking at.
 *
 * So the scan mints this tiny signed ticket naming the match ids that ARE
 * entitled to incumbent intel (exactly the free ≤FREE_ANONYMOUS_RADAR_RESULTS
 * matches it would have enriched before), and the lazy endpoint verifies the
 * signature + id membership before doing any lookup. Fail-closed: no ticket, a
 * tampered ticket, or a non-member id → no upstream call, no data. The payload
 * carries no PII (match ids + a timestamp), and signing reuses the existing
 * RADAR_HANDOFF_SECRET — no new secret, no new crypto path.
 *
 * Domain separation: the HMAC is taken over a purpose prefix, so a handoff
 * cookie value can never be replayed as an intel ticket (or vice versa).
 */
const INTEL_TICKET_PREFIX = "radar-intel-ticket:v1:";
/** 6 h — the scale of a single Radar session (the handoff cookie is 24 h
 *  because it must survive signup; a ticket only has to outlive the results
 *  screen it was minted for). */
const INTEL_TICKET_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export interface RadarIntelTicketPayload {
  /** Match ids entitled to incumbent intel (the free ≤3). */
  m: number[];
  /** Minted-at epoch ms. */
  k: number;
}
function cleanIntelIds(ids: unknown): number[] {
  return Array.isArray(ids)
    ? [...new Set(ids.filter((n) => Number.isInteger(n) && (n as number) > 0).map(Number))].slice(0, 25)
    : [];
}
/** Sign a ticket for the given entitled match ids. THROWS (like
 *  signRadarHandoff) when RADAR_HANDOFF_SECRET is unset — callers wrap it, and
 *  a missing secret must degrade to "intel unavailable", never to an
 *  unverified/forgeable ticket. */
export function signRadarIntelTicket(ids: readonly number[]): string {
  const s = getRadarHandoffSecret();
  const payload: RadarIntelTicketPayload = { m: cleanIntelIds([...ids]), k: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", s).update(INTEL_TICKET_PREFIX + body).digest());
  return `${body}.${sig}`;
}
/** Verify a ticket → payload, or null on ANY failure (fail-closed): bad
 *  signature, wrong purpose, expired/future-dated, or junk. */
export function verifyRadarIntelTicket(raw: string | null | undefined): RadarIntelTicketPayload | null {
  try {
    const s = getRadarHandoffSecret(); // THROWS if unset — converted to null below (fail-closed)
    if (!raw || typeof raw !== "string" || raw.length > 4096) return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expect = b64url(crypto.createHmac("sha256", s).update(INTEL_TICKET_PREFIX + body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64url(body).toString("utf8")) as Partial<RadarIntelTicketPayload>;
    if (!p || !Array.isArray(p.m)) return null;
    const k = typeof p.k === "number" && Number.isFinite(p.k) ? p.k : 0;
    const now = Date.now();
    if (k <= 0 || k > now + ALLOWED_SKEW_MS || now - k > INTEL_TICKET_MAX_AGE_MS) return null;
    return { m: cleanIntelIds(p.m), k };
  } catch (err) {
    // Fail-closed. Loud only on the missing-secret config case (same rule as
    // verifyRadarHandoff) — constant string only, never the payload/secret.
    if (err instanceof Error && err.message.includes("RADAR_HANDOFF_SECRET is required")) {
      console.error("[radar-handoff] intel ticket unavailable: missing server configuration (RADAR_HANDOFF_SECRET)");
    }
    return null;
  }
}
/** THE entitlement check the lazy intel endpoint runs: a verified ticket that
 *  explicitly names this match id. */
export function intelTicketAllows(
  payload: RadarIntelTicketPayload | null,
  matchId: number,
): boolean {
  return !!payload && Number.isInteger(matchId) && payload.m.includes(matchId);
}
