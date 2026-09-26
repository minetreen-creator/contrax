/**
 * Radar → signup/login funnel state (NO EMAIL).
 *
 * This module remembers the anonymous visitor's Contract Radar session entirely
 * in the BROWSER (localStorage + sessionStorage). A separate server endpoint
 * may store the four non-contact criteria against the existing first-party
 * visitor id for journey continuity, but this module never collects, stores,
 * or transmits an email address.
 *
 * Three small stores:
 *   answers   (localStorage)   the visitor's radar criteria (trade/NAICS, state,
 *                              cert, size). Synchronized onto /radar inputs when
 *                              the visitor returns, and read by /signup so a
 *                              radar→signup continuation feels like a ~10s resume.
 *   prefill   (sessionStorage) the same criteria forwarded to /onboarding so the
 *                              profile fields (certification / states / NAICS)
 *                              arrive pre-filled after signup.
 *   seen      (localStorage)   the matches actually revealed in the radar scan
 *                              (server-computed ids/titles/scores — never
 *                              fabricated) + the total found + criteria. Read by
 *                              /dashboard on/after login to show the in-app
 *                              "your radar matches are waiting" notification and
 *                              drive the "save all" action.
 *
 * All accessors are defensive (try/catch, typeof window guard) so a storage
 * failure can never break a page, SSR, or rendering.
 */

export type RadarCertId = "sdvosb" | "8a" | "wosb" | "hubzone" | "sb";
export type RadarSizeId = "under250k" | "under1m" | "under10m" | "any";

export interface RadarAnswers {
  trade: string;
  state: string;
  cert: RadarCertId;
  sizePref: RadarSizeId;
}

export const RADAR_CERT_LABELS: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};

export const RADAR_SIZE_LABELS: Record<string, string> = {
  under250k: "< $250K",
  under1m: "< $1M",
  under10m: "< $10M",
  any: "Any size",
};

export interface RadarSeenMatch {
  id: number;
  title: string;
  agency: string | null;
  score: number;
  score_label: "Strong Match" | "Good Match" | "Potential Match";
  /** The bid's real closing/deadline date (ISO, from the `bids.due_date`
   *  column). Null when the bid has no due date — callers MUST omit any
   *  "Due …" line in that case (never fabricated or derived). */
  due_date: string | null;
  /** Link to the full original solicitation (SAM.gov) so the in-app banner
   *  can deep-link "View Full Solicitation Details" for the top match. */
  source_url: string | null;
  category?: string | null;
  location?: string | null;
  set_aside?: string | null;
  set_aside_label?: string | null;
  naics_code?: string | null;
  estimated_value?: string | null;
  estimated_value_num?: number | null;
  days_remaining?: number | null;
  reasons?: string[];
  qualifications?: string[];
  requirements?: string[];
  next_action?: string;
  trade_provenance?: unknown;
  incumbent?: unknown;
  learned?: unknown;
}

export interface RadarSeen {
  /** ISO timestamp used to refuse stale browser-cached results. */
  savedAt?: string;
  /** Criteria that produced the scanned matches. */
  answers: RadarAnswers;
  /** Human set-aside label (e.g. "SDVOSB") for the banner copy. */
  certLabel: string;
  /** Total matches the scan found (>= 0). */
  total: number;
  /** How many of those matches the visitor actually revealed (<= 3 free). */
  seenCount: number;
  /** The server-computed matches (ids/titles/scores — nothing fabricated). */
  matches: RadarSeenMatch[];
  /** Preserve the server's honest local/nationwide/related buckets. */
  sections?: {
    local: RadarSeenMatch[];
    nationwide: RadarSeenMatch[];
    related: RadarSeenMatch[];
  };
}

/** Browser results are a convenience, never a second opportunity database. */
export const RADAR_SEEN_MAX_AGE_MS = 72 * 60 * 60 * 1000;

function deadlineStillOpen(value: string | null, now: number): boolean {
  if (!value) return true;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  // Source dates are day-granular. Keep the card through the stated day.
  return parsed + 86_400_000 > now;
}

/**
 * Return a freshness-checked copy of browser-cached Radar results. Legacy
 * records have no trustworthy timestamp and deliberately do not restore.
 */
export function freshRadarSeen(seen: RadarSeen | null, now = Date.now()): RadarSeen | null {
  if (!seen?.savedAt) return null;
  const saved = Date.parse(seen.savedAt);
  if (!Number.isFinite(saved) || saved > now || now - saved > RADAR_SEEN_MAX_AGE_MS) return null;
  if (!Array.isArray(seen.matches) || !seen.sections) return null;
  if (!Array.isArray(seen.sections.local) || !Array.isArray(seen.sections.nationwide) || !Array.isArray(seen.sections.related)) return null;
  const matches = seen.matches.filter((m) => deadlineStillOpen(m.due_date, now));
  if (matches.length === 0) return null;
  const keep = (rows: RadarSeenMatch[]) => rows.filter((m) => deadlineStillOpen(m.due_date, now));
  return {
    ...seen,
    total: matches.length,
    seenCount: Math.min(seen.seenCount, matches.length),
    matches,
    sections: {
      local: keep(seen.sections.local),
      nationwide: keep(seen.sections.nationwide),
      related: keep(seen.sections.related),
    },
  };
}

export const RADAR_ANSWERS_KEY = "contrax_radar_answers";

const KEYS = {
  answers: RADAR_ANSWERS_KEY,
  prefill: "contrax_radar_prefill",
  seen: "contrax_radar_seen",
  // First-run guidance banner (owner rework 2026-09-26, PR-A): once the visitor
  // has run a scan or dismissed the banner, it must not come back. Stored with
  // the SAME fail-open localStorage helpers as the rest of the radar session.
  guidanceDone: "contrax_radar_guidance_done",
} as const;

function safeGet<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* never let storage fail break the flow */
  }
}

// ── Answers ─────────────────────────────────────────────────────────────────
export function saveRadarAnswers(answers: RadarAnswers): void {
  safeSet(KEYS.answers, answers);
}
export function getRadarAnswers(): RadarAnswers | null {
  return safeGet<RadarAnswers>(KEYS.answers);
}
export function clearRadarAnswers(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.answers);
  } catch { /* noop */ }
}

// ── Prefill (sessionStorage → onboarding) ────────────────────────────────────
export function saveRadarPrefill(answers: RadarAnswers): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(KEYS.prefill, JSON.stringify(answers));
  } catch {
    /* noop */
  }
}
export function getRadarPrefill(): RadarAnswers | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(KEYS.prefill);
    if (!raw) return null;
    return JSON.parse(raw) as RadarAnswers;
  } catch {
    return null;
  }
}
export function clearRadarPrefill(): void {
  try {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(KEYS.prefill);
  } catch { /* noop */ }
}

// ── Seen matches ─────────────────────────────────────────────────────────────
export function saveRadarSeen(seen: RadarSeen): void {
  safeSet(KEYS.seen, seen);
}
export function getRadarSeen(): RadarSeen | null {
  return safeGet<RadarSeen>(KEYS.seen);
}
export function clearRadarSeen(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.seen);
  } catch { /* noop */ }
}
// ── First-run guidance (owner rework 2026-09-26, PR-A) ────────────────────────
/** True once the visitor has run a real scan OR dismissed the guidance banner. */
export function getRadarGuidanceDone(): boolean {
  return safeGet<boolean>(KEYS.guidanceDone) === true;
}
/** Sticky (localStorage, fail-open) — the banner never returns after this. */
export function saveRadarGuidanceDone(): void {
  safeSet(KEYS.guidanceDone, true);
}
