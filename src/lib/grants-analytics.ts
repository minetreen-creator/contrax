/**
 * Contrax Grants — isolated analytics events (owner order 2026-09-16).
 *
 * SIX standalone event names. They ride the app's ONE canonical client-side
 * writer (trackEvent → POST /api/track-visitor, kind="event"), so they inherit
 * the existing discipline for free: the intake handler's isBot() filter, the 1s
 * write-time collapse (event + visitor + path), the QA/admin/test exclusions,
 * and the persistent contrax_vid / visit_id identity. Nothing new is invented
 * here and NO server-side grants endpoint writes analytics.
 *
 * ISOLATION CONTRACT (acceptance check 7): these names are deliberately absent
 * from every funnel stage definition — ACTIVATION_EVENTS, SIGNUP_VIEWED/STARTED
 * events, RADAR_CONVERSION_* sets, the Radar-leads funnel, and the admin unified
 * funnel. They are display-only rows in funnel_events, exactly like
 * `bid_scout_viewed` / `autopsy_home_cta`: a grants search never synthesizes
 * radar_completed, signup_completed, activated, or paid.
 * src/lib/grants.test.ts asserts this at the source-text level.
 */
import { trackEvent } from "~/lib/track";

export const GRANTS_EVENTS = {
  pageViewed: "grants_page_viewed",
  searchStarted: "grants_search_started",
  searchCompleted: "grants_search_completed",
  searchFailed: "grants_search_failed",
  resultOpened: "grants_result_opened",
  upgradeClicked: "grants_upgrade_clicked",
} as const;

/** All six names, for the isolation assertions in grants.test.ts. */
export const GRANTS_EVENT_NAMES: readonly string[] = Object.values(GRANTS_EVENTS);

/** The page path every grants event is stamped with (path is part of the 1s dedupe key). */
export const GRANTS_PAGE_PATH = "/grants";

/**
 * Fires one grants event through the shared writer. Never throws, never blocks,
 * and is a no-op during SSR (trackEvent itself guards on `window`).
 */
export function trackGrantsEvent(
  event: (typeof GRANTS_EVENTS)[keyof typeof GRANTS_EVENTS],
  label?: string,
): void {
  trackEvent(event, label, GRANTS_PAGE_PATH);
}
