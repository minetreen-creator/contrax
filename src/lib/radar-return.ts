/**
 * Returning-visitor prompt on Radar (owner 2026-11-08: "I want to know who people are" → "yes build
 * 1 and 2"). A visitor who keeps coming back to the open-bids panel without an account is asked,
 * on their third day, to create one, so they tell us who they are instead of us guessing.
 *
 * Visit days are counted ONLY in this browser's own storage (nothing is sent anywhere). PURE apart
 * from the small storage wrappers, which never throw.
 */
const DAYS_KEY = "contrax_radar_days";
const DISMISS_KEY = "contrax_radar_return_dismissed";
/** Show on the third distinct day of visits. */
export const RETURN_PROMPT_DAYS = 3;
/** After "Not now", ask again a week later. */
export const RETURN_PROMPT_SNOOZE_MS = 7 * 86_400_000;
const MAX_DAYS_KEPT = 30;

/** Add today ("2026-11-08") to the visit days; returns the new list (distinct, newest last). PURE. */
export function addVisitDay(days: readonly string[], today: string): string[] {
  const kept = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== today);
  return [...kept, today].slice(-MAX_DAYS_KEPT);
}

/** Whether to show the prompt. Unknown sign-in state (null) never shows it. PURE. */
export function shouldShowReturnPrompt(input: { visitDays: number; signedIn: boolean | null; dismissedAt: number | null; now: number }): boolean {
  if (input.signedIn !== false) return false;
  if (input.visitDays < RETURN_PROMPT_DAYS) return false;
  return input.dismissedAt === null || input.now - input.dismissedAt >= RETURN_PROMPT_SNOOZE_MS;
}

/** The signup link: the account is set up for this trade and state, and lands back on its bids. PURE. */
export function returnSignupHref(trade: string, state: string): string {
  const next = `/radar?${new URLSearchParams({ trade, state })}`;
  return `/signup?${new URLSearchParams({ source: "radar", trade, state, next })}`;
}

function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Record today's visit in this browser; returns how many distinct days it has seen. Never throws. */
export function recordRadarVisitDay(now: Date = new Date()): number {
  try {
    const raw = JSON.parse(localStorage.getItem(DAYS_KEY) ?? "[]");
    const days = addVisitDay(Array.isArray(raw) ? raw.map(String) : [], localDay(now));
    localStorage.setItem(DAYS_KEY, JSON.stringify(days));
    return days.length;
  } catch {
    return 0;
  }
}

export function readReturnDismissedAt(): number | null {
  try {
    const n = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function dismissReturnPrompt(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(now));
  } catch {
    /* storage blocked */
  }
}
