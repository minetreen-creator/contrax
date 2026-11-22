/**
 * A visitor who runs the same search again and again (owner 2026-11-20: an HVAC contractor near
 * Denver ran "hvac, Colorado" five times in three days and never opened a bid or the price). The
 * search page sees a first-time visitor each time, so on the third run of the same trade and state
 * within a week it says so and offers the $9 pass, which emails new bids every morning.
 *
 * PURE and client-safe. The count lives in the visitor's own browser; nothing is sent anywhere.
 */

export const REPEAT_SEARCH_KEY = "contrax_repeat_search_v1";
/** Runs of the same search inside this window are counted. */
export const REPEAT_WINDOW_DAYS = 7;
/** The offer shows from this many runs. */
export const REPEAT_OFFER_FROM = 3;
/** Two runs closer together than this are one visit (a refresh, a back button). */
export const REPEAT_GAP_HOURS = 3;

const HOUR = 60 * 60 * 1000;

export function repeatSearchId(trade: string, state: string | null | undefined): string {
  return `${String(trade ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60)}|${String(state ?? "").trim().toUpperCase().slice(0, 2)}`;
}

/**
 * Add this run to what the browser holds and say how many separate visits ran the same search in
 * the last week. Bad or missing stored text counts as nothing stored.
 */
export function recordRepeatSearch(raw: string | null | undefined, trade: string, state: string | null | undefined, now: number): { raw: string; count: number } {
  const id = repeatSearchId(trade, state);
  let all: Record<string, number[]> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed as Record<string, number[]>;
  } catch {
    all = {};
  }
  const since = now - REPEAT_WINDOW_DAYS * 24 * HOUR;
  const kept: Record<string, number[]> = {};
  for (const [key, times] of Object.entries(all).slice(-20)) {
    const recent = Array.isArray(times) ? times.filter((t) => typeof t === "number" && t > since && t <= now) : [];
    if (recent.length) kept[key] = recent.slice(-20);
  }
  const mine = kept[id] ?? [];
  if (!id.startsWith("|") && (mine.length === 0 || now - mine[mine.length - 1] >= REPEAT_GAP_HOURS * HOUR)) mine.push(now);
  if (mine.length) kept[id] = mine;
  return { raw: JSON.stringify(kept), count: mine.length };
}

/** The line above the results, or null when this is not yet a repeat search. */
export function repeatSearchOffer(count: number, trade: string, stateName: string | null | undefined): { headline: string; detail: string; button: string } | null {
  if (count < REPEAT_OFFER_FROM) return null;
  const what = String(trade ?? "").trim();
  if (!what) return null;
  const where = stateName ? ` in ${stateName}` : "";
  return {
    headline: `You've checked ${what} bids${where} ${count} times this week.`,
    detail: "Get the new ones emailed every morning at 6 AM, so you stop checking. $9 a month, cancel anytime.",
    button: "Email me the new ones: $9 a month →",
  };
}
