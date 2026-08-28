/**
 * Persistent per-visitor + per-session identity (self-hosted, first-party only).
 *
 * PURPOSE: today every row in `page_views` / `funnel_events` is an isolated
 * record with no ID linking a single visitor's journey across pages and steps,
 * so the hero → map → radar → signup funnel can't be reconstructed as a
 * coherent path, and bots/QA can't be separated from real humans reliably
 * (grouping by IP is unreliable). This module assigns:
 *
 *   1. `contrax_vid`  — a persistent per-visitor UUID cookie (~1 year), set once
 *                       on the visitor's first site hit and recorded on EVERY
 *                       page_view and funnel_event so the whole funnel can be
 *                       rebuilt per visitor. Survives across sessions/browsers
 *                       within the same browser profile (until the cookie is
 *                       cleared or expires).
 *   2. `visit` id      — a per-tab-session id kept in sessionStorage (cleared
 *                       when the browser tab/session ends), so we can tell
 *                       "unique visitors ever" (contrax_vid) apart from
 *                       "visits/sessions" (visit). Regenerated for each new
 *                       tab session.
 *
 * ALL identity is first-party, self-hosted analytics only — there are NO
 * third-party trackers, and we never share these IDs anywhere. A visitor who
 * blocks cookies / sessionStorage simply records no visitor_id (the columns are
 * nullable and optional; every INSERT still succeeds without them).
 *
 * This module MUST stay PURE — no server-only imports, no DB access, no node
 * builtins — so both the client snippet (src/routes/__root.tsx, src/lib/track.ts)
 * and any test can import it. The only globals used are `window`, `document`
 * and `crypto.randomUUID` (guarded by `typeof window === "undefined"` checks).
 *
 * Usage (client only):
 *   import { getOrCreateVisitorId, getOrCreateVisitId } from "~/lib/visitor";
 *   const payload = {
 *     visitor_id: getOrCreateVisitorId(),
 *     visit_id: getOrCreateVisitId(),
 *   };
 */
export const VISITOR_COOKIE_NAME = "contrax_vid";
/** ~1 year. The visitor id is deliberately long-lived so a whole funnel can be
 * rebuilt across many sessions. */
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** sessionStorage key for the per-tab visit id (cleared when the tab closes). */
const VISIT_STORAGE_KEY = "contrax_visit_id";

/** Read a cookie value from document.cookie (client only). */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  try {
    for (const part of document.cookie.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) {
        const val = part.slice(idx + 1).trim();
        return val.length ? val : null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Generate a fresh UUID (browser and modern Node/Bun both support this). */
function newUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the simple generator below
  }
  // Minimal RFC-4122-ish fallback so the module never throws in odd runtimes.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Return the persistent per-visitor UUID, creating+setting the `contrax_vid`
 * cookie on first call. Safe to call from any client code path and from any
 * number of beacon helpers — the cookie is only written when absent, and the
 * value is stable for a year. Never throws.
 */
export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";
  const existing = readCookie(VISITOR_COOKIE_NAME);
  if (existing) return existing;
  const id = newUuid();
  try {
    document.cookie = `${VISITOR_COOKIE_NAME}=${id}; Path=/; SameSite=Lax; Max-Age=${VISITOR_COOKIE_MAX_AGE}`;
  } catch {
    // cookie write can be blocked by policy — return the id anyway so the
    // current call still records it (this page's beacons carry it in the body).
  }
  return id;
}

/**
 * Return the per-tab-session id (stored in sessionStorage so it naturally
 * resets when the tab/session ends), creating it on first call per session.
 * Distinguishes visits/sessions from unique visitors. Never throws — falls back
 * to a fresh per-call id if sessionStorage is unavailable.
 */
export function getOrCreateVisitId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(VISIT_STORAGE_KEY);
    if (existing) return existing;
    const id = newUuid();
    window.sessionStorage.setItem(VISIT_STORAGE_KEY, id);
    return id;
  } catch {
    // sessionStorage blocked — fall back to a fresh id per call (still lets the
    // funnel be grouped, just coarser across full page reloads).
    return newUuid();
  }
}

/**
 * Convenience: both ids in one object, for beacon payloads. Keeps call sites
 * consistent and free of scattered fetch logic.
 */
export function trackingIds(): { visitor_id: string; visit_id: string } {
  return { visitor_id: getOrCreateVisitorId(), visit_id: getOrCreateVisitId() };
}
