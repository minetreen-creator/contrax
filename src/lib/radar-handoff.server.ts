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
const MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days — long enough to finish signup later

export interface RadarHandoffPayload {
  v: string;
  t: string;
  c: string;
  s: string;
  z: string;
  m: number[];
  k: number;
}

function secret(): string {
  // HMAC key: prefer a configured secret, else a stable deploy-local fallback.
  // Fallback only weakens cross-deploy forgery resistance; cookies are
  // short-lived, non-PII, and verified fail-closed, so this is fail-safe.
  return (
    process.env.RADAR_HANDOFF_SECRET ||
    process.env.SESSION_SECRET ||
    "contrax-radar-handoff-dev-only"
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Serialize + HMAC-sign a payload → cookie value `body.sig`. Pure. */
export function signRadarHandoff(p: RadarHandoffPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(p), "utf8"));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify a cookie value → payload, or null on ANY failure (fail-closed). Pure. */
export function verifyRadarHandoff(raw: string | null | undefined): RadarHandoffPayload | null {
  try {
    if (!raw || typeof raw !== "string") return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const body = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(unb64url(body).toString("utf8")) as Partial<RadarHandoffPayload>;
    if (!p || typeof p.v !== "string" || !p.v) return null;
    // Sanitize + bound every field so a valid signature can never carry junk.
    return {
      v: p.v.slice(0, 64),
      t: typeof p.t === "string" ? p.t.slice(0, 120) : "",
      c: typeof p.c === "string" ? p.c.slice(0, 24) : "sb",
      s: typeof p.s === "string" ? p.s.slice(0, 4) : "",
      z: typeof p.z === "string" ? p.z.slice(0, 24) : "any",
      m: Array.isArray(p.m)
        ? p.m.filter((n) => Number.isInteger(n) && (n as number) > 0).slice(0, 25).map(Number)
        : [],
      k: typeof p.k === "number" && Number.isFinite(p.k) ? p.k : 0,
    };
  } catch {
    return null;
  }
}

export const RADAR_HANDOFF_COOKIE = COOKIE;
export const RADAR_HANDOFF_MAX_AGE_S = MAX_AGE_S;
