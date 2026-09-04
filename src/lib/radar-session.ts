/**
 * Radar → signup/login funnel state (LOCAL-ONLY, NO EMAIL).
 *
 * This module remembers the anonymous visitor's Contract Radar session entirely
 * in the BROWSER (localStorage + sessionStorage). It never collects, stores, or
 * transmits an email address — owner-directed: the radar→signup funnel is
 * strengthened WITHOUT any email capture.
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
  score_label: string;
  /** The bid's real closing/deadline date (ISO, from the `bids.due_date`
   *  column). Null when the bid has no due date — callers MUST omit any
   *  "Due …" line in that case (never fabricated or derived). */
  due_date: string | null;
  /** Link to the full original solicitation (SAM.gov) so the in-app banner
   *  can deep-link "View Full Solicitation Details" for the top match. */
  source_url: string | null;
}

export interface RadarSeen {
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
}

export const RADAR_ANSWERS_KEY = "contrax_radar_answers";

const KEYS = {
  answers: RADAR_ANSWERS_KEY,
  prefill: "contrax_radar_prefill",
  seen: "contrax_radar_seen",
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
