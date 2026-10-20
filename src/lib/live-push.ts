/**
 * Mission Control live alerts (issue #788, owner 2026-10-20): one iPhone web
 * push to the owner for each new real visitor session. PURE (no I/O):
 * who qualifies, what the lock screen says, and subscription validation.
 * Storage and sending live in live-push.server.ts.
 */
import { dataCenterLocation } from "./visitor-intel";

/** Our own test IP, Anthropic's outbound range, crawlers and link-preview
 *  fetchers — the same IP arms BOT_EXCLUSION_SQL drops from every board. */
const EXCLUDED_IP_PREFIXES = [
  "160.79.104.", "160.79.105.", "160.79.106.", "160.79.107.", "160.79.108.", "160.79.109.", "160.79.110.", "160.79.111.",
  "66.249.", "66.102.", "74.125.", "40.77.", "157.55.", "207.46.",
  "66.220.", "31.13.", "173.252.", "104.189.", "69.171.", "157.240.",
];
const EXCLUDED_IPS = new Set(["34.214.71.218"]);

export interface VisitFacts {
  ip: string | null;
  path: string;
  city: string | null;
  region: string | null;
  /** True when the signed-in user is an admin or test account. */
  internal: boolean;
  /** Successful server-side BotID human verdict; unknown traffic must not push. */
  verifiedHuman: boolean;
}

/** Does this first page of a visit deserve an alert? Bots and QA are already dropped before intake. */
export function alertEligible(v: VisitFacts): boolean {
  if (!v.verifiedHuman || v.internal) return false;
  if (v.path.startsWith("/admin") || v.path.startsWith("/api/")) return false;
  const ip = v.ip ?? "";
  if (EXCLUDED_IPS.has(ip) || EXCLUDED_IP_PREFIXES.some((p) => ip.startsWith(p))) return false;
  // Email link scanners (Microsoft Safe Links etc.) come from data-center towns.
  if (dataCenterLocation(v.city, v.region)) return false;
  return true;
}

export interface AlertText {
  title: string;
  body: string;
  tag: string;
}

/** Lock-screen text: approximate place, device, new or returning, landing page. Never an IP or email. */
export function alertText(v: { city: string | null; region: string | null; device: string | null; returning: boolean; path: string; visitId: string }): AlertText {
  const place = [v.city, v.region].filter(Boolean).join(", ") || "Unknown location";
  const device = v.device ? v.device.charAt(0).toUpperCase() + v.device.slice(1).toLowerCase() : "Device unknown";
  const page = v.path.split("?")[0].slice(0, 60) || "/";
  return {
    title: v.returning ? "🔁 Returning visitor on Contrax" : "👋 New visitor on Contrax",
    body: `${place} · ${device} · ${page}`,
    tag: `visit-${v.visitId}`.slice(0, 64),
  };
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Accepts only an https push endpoint with both keys; anything else is null. */
export function parseSubscription(raw: unknown): PushSubscriptionInput | null {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || !s.keys) return null;
  const { p256dh, auth } = s.keys;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || s.endpoint.length > 1000) return null;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return null;
  return { endpoint: s.endpoint, p256dh, auth };
}

/** A push service answering 404 or 410 means the subscription is gone for good. */
export function subscriptionExpired(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
