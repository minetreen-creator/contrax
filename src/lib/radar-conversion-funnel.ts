/**
 * RADAR CONVERSION FUNNEL (owner 2026-09-07, Radar Conversion Sprint PR2).
 *
 * The NEW, SEPARATE 9-stage conversion funnel — kept entirely apart from the
 * existing 7-stage Radar-Leads funnel (src/lib/radar-leads-funnel.ts) and from
 * the CEO unified funnel (src/routes/api/admin/unified-funnel.ts, whose
 * definitions/numbers are NEVER touched by this module).
 *
 *   1. qualified      — QUALIFYING_EVENTS (same intent-signal superset the CEO
 *                         funnel uses: ACTIVATION_EVENTS + radar_scan_complete
 *                         + signup viewed/started + signup_abandon/success +
 *                         hero_cta_click + radar_scan_start)
 *   2. radar_started  — radar_scan_start
 *   3. radar_completed— radar_scan_complete
 *   4. results_viewed — radar_results_viewed (PR1)
 *   5. unlock_shown   — radar_results_unlock_shown (PR1)
 *   6. unlock_clicked — radar_results_unlock_clicked (PR1)
 *   7. signup         — signup_success (REUSED, no duplicate event)
 *   8. activated      — ACTIVATION_EVENTS (REUSED)
 *   9. paid           — derived from users.subscription_status = 'active' on
 *                         accounts whose visitor is conversion-funnel-involved
 *                         (same attribution pattern as the radar-leads funnel)
 *
 * Counting semantics (owner spec): DISTINCT visitors per stage; consecutive
 * drop-off; 0 when the prior stage is 0. Same bot/QA/admin exclusions as every
 * admin surface (BOT_EXCLUSION_SQL + qaFunnelExclusionSQL +
 * adminFunnelExclusionSQL). Signup/activated/paid reuse existing events
 * attributed to funnel-involved visitors (never double-count organic traffic).
 */
import {
  ACTIVATION_EVENTS,
  SIGNUP_VIEWED_EVENTS,
  SIGNUP_STARTED_EVENTS,
  RADAR_COMPLETE_EVENT,
} from "~/lib/tracking-intake";

export const RADAR_CONVERSION_FUNNEL_STAGES = [
  { stage: "qualified", label: "Qualified Visit" },
  { stage: "radar_started", label: "Radar Started" },
  { stage: "radar_completed", label: "Radar Completed" },
  { stage: "results_viewed", label: "Results Viewed" },
  { stage: "unlock_shown", label: "Unlock Shown" },
  { stage: "unlock_clicked", label: "Unlock Clicked" },
  { stage: "signup", label: "Signup" },
  { stage: "activated", label: "Activated" },
  { stage: "paid", label: "Paid" },
] as const;

/** Per-stage event sets (single-event stages except qualified + activated). */
export const RADAR_CONVERSION_QUALIFYING_EVENTS: readonly string[] = [
  ...ACTIVATION_EVENTS,
  RADAR_COMPLETE_EVENT,
  ...SIGNUP_VIEWED_EVENTS,
  ...SIGNUP_STARTED_EVENTS,
  "signup_abandon",
  "signup_success",
  "hero_cta_click",
  "radar_scan_start",
];
export const RADAR_CONVERSION_START_EVENT = "radar_scan_start";
export const RADAR_CONVERSION_COMPLETE_EVENT = RADAR_COMPLETE_EVENT;
export const RADAR_CONVERSION_RESULTS_VIEWED_EVENT = "radar_results_viewed";
export const RADAR_CONVERSION_UNLOCK_SHOWN_EVENT = "radar_results_unlock_shown";
export const RADAR_CONVERSION_UNLOCK_CLICKED_EVENT = "radar_results_unlock_clicked";
export const RADAR_CONVERSION_SIGNUP_EVENT = "signup_success";
export const RADAR_CONVERSION_ACTIVATION_EVENTS: readonly string[] = [...ACTIVATION_EVENTS];

/**
 * RADAR SCAN DIAGNOSTICS (owner 2026-09-28) — the two cohort dimensions that
 * explain WHY the funnel leaks between "radar_completed" and "signup":
 *
 *   anonymousMatches / anonymousZero / signedInMatches / signedInZero
 *     — the scan cohort (signed-in vs anonymous × matches-found vs zero
 *       matches). These FOUR begin collecting only when this change ships, so
 *       a fresh deploy reads 0 until the first completed scan arrives.
 *
 *   anonymousResultsViewed, lockedShown, lockedClicked, smallCtaShown,
 *   smallCtaClicked — the results-screen surface counters. These are
 *   PRE-EXISTING events (already tracked in radar.tsx); this table only starts
 *   counting them in one place.
 *
 * The keys here are the SHORT diagnostic keys the admin payload is keyed by;
 * the values are the exact wire event names. Never rename an existing value —
 * an event already written to `funnel_events` would stop being counted.
 */
export const RADAR_DIAGNOSTIC_EVENTS = {
  anonymousMatches: "radar_scan_anonymous_matches",
  anonymousZero: "radar_scan_anonymous_zero",
  signedInMatches: "radar_scan_signed_in_matches",
  signedInZero: "radar_scan_signed_in_zero",
  anonymousResultsViewed: "radar_results_viewed",
  lockedShown: "radar_results_unlock_shown",
  lockedClicked: "radar_results_unlock_clicked",
  smallCtaShown: "radar_results_cta_shown",
  smallCtaClicked: "radar_results_cta_clicked",
} as const;

/** Every event that makes a visitor "funnel-involved" (attribution key). */
export const RADAR_CONVERSION_INVOLVED_EVENTS: readonly string[] = [
  ...RADAR_CONVERSION_QUALIFYING_EVENTS,
  RADAR_CONVERSION_RESULTS_VIEWED_EVENT,
  RADAR_CONVERSION_UNLOCK_SHOWN_EVENT,
  RADAR_CONVERSION_UNLOCK_CLICKED_EVENT,
];

export interface RadarConversionFunnelStage {
  stage: string;
  label: string;
  count: number;
  /** Consecutive drop-off % vs the previous stage (null for the base stage or when prior = 0). */
  dropOffPct: number | null;
}
export interface RadarConversionFunnelResult {
  rangeDays: number;
  from: string;
  to: string;
  funnel: RadarConversionFunnelStage[];
  /**
   * Radar scan diagnostics (owner 2026-09-28) — DISTINCT visitors per
   * RADAR_DIAGNOSTIC_EVENTS key. Always zero-filled for every key so a reader
   * never has to distinguish "event absent" from "not yet collected".
   * Counts are per-event and MAY overlap (one visitor can appear in more than
   * one cohort, e.g. a scan with matches that is later repeated with none).
   */
  diagnostics: Record<string, number>;
}

/** Consecutive drop-off: lost vs the previous stage; 0 when prior = 0. */
export function conversionDropOff(n: number, prev: number | null): number | null {
  if (prev == null) return null;
  if (prev <= 0) return 0;
  const p = Math.round((1 - n / prev) * 100);
  return p > 0 ? p : 0;
}

export function emptyRadarConversionFunnel(days: number): RadarConversionFunnelResult {
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400 * 1000);
  return {
    rangeDays: days,
    from: from.toISOString(),
    to: now.toISOString(),
    funnel: RADAR_CONVERSION_FUNNEL_STAGES.map((s, i) => ({
      stage: s.stage,
      label: s.label,
      count: 0,
      dropOffPct: i === 0 ? null : 0,
    })),
    // Every diagnostic key exists and reads 0 — a caller (or the admin panel)
    // never has to distinguish "no such diagnostic" from "not yet collected".
    diagnostics: Object.fromEntries(Object.keys(RADAR_DIAGNOSTIC_EVENTS).map((key) => [key, 0])),
  };
}
