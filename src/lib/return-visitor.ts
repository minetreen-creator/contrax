/**
 * Returning-visitor catch (owner 2026-10-23: "I'm tired of people just coming
 * into the site repeatedly and leaving every time"). PURE.
 *
 * Days this browser visited are kept in localStorage. On the 2nd day a small
 * slide-up offers new bids by email (closable); from the 3rd day a visitor
 * who still hasn't left an email or signed in gets a full-page email gate.
 * Anyone signed in, anyone who left an email anywhere on the site, and the
 * pages where a gate would get in the way never see either.
 */

export const VISIT_DAYS_KEY = "contrax_visit_days";
/** Set by every email capture on the site (markEmailGiven). */
export const HAS_EMAIL_KEY = "contrax_has_email";
/** The day the slide-up was closed (it stays closed that day). */
export const SLIDE_CLOSED_KEY = "contrax_return_slide_closed";

export const SLIDE_FROM_DAY = 2;
export const GATE_FROM_DAY = 3;
const MAX_DAYS_KEPT = 30;

/** Pages that never show the catch: sign-in/up and account flows, checkout, legal, admin. */
const EXCLUDED = /^\/(admin|login|signup|forgot-password|reset-password|onboarding|post-checkout|upgrade|dashboard|settings|privacy|terms|security|unsubscribe|api)(\/|$)/;

export function isExcludedPath(path: string): boolean {
  return EXCLUDED.test(path.split(/[?#]/)[0]);
}

/** The visit days with today added (each day once, newest kept). */
export function withToday(days: unknown, today: string): string[] {
  const list = Array.isArray(days) ? days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  return [...new Set([...list, today])].sort().slice(-MAX_DAYS_KEPT);
}

export type ReturnStage = "none" | "slide" | "gate";

export function returnStage(s: {
  visitDays: number;
  hasEmail: boolean;
  signedIn: boolean;
  path: string;
  slideClosedToday: boolean;
}): ReturnStage {
  if (s.hasEmail || s.signedIn || isExcludedPath(s.path)) return "none";
  if (s.visitDays >= GATE_FROM_DAY) return "gate";
  if (s.visitDays >= SLIDE_FROM_DAY && !s.slideClosedToday) return "slide";
  return "none";
}

/** Today in the visitor's own time zone, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Call after any successful email capture: this browser never sees the catch again. */
export function markEmailGiven(): void {
  try {
    localStorage.setItem(HAS_EMAIL_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

export function hasGivenEmail(): boolean {
  try {
    return localStorage.getItem(HAS_EMAIL_KEY) === "1";
  } catch {
    return false;
  }
}
