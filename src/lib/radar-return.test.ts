import { describe, expect, test } from "bun:test";
import { addVisitDay, RETURN_PROMPT_SNOOZE_MS, returnSignupHref, shouldShowReturnPrompt } from "./radar-return";

// Owner 2026-11-08: ask a returning Radar visitor to create an account on their third day.
describe("returning-visitor prompt", () => {
  test("visit days are distinct, newest last, capped at 30", () => {
    expect(addVisitDay([], "2026-11-08")).toEqual(["2026-11-08"]);
    expect(addVisitDay(["2026-11-06", "2026-11-08"], "2026-11-08")).toEqual(["2026-11-06", "2026-11-08"]);
    expect(addVisitDay(["junk", "2026-11-06"], "2026-11-07")).toEqual(["2026-11-06", "2026-11-07"]);
    const many = Array.from({ length: 40 }, (_, i) => `2026-09-${String((i % 30) + 1).padStart(2, "0")}`);
    expect(addVisitDay(many, "2026-11-08").length).toBeLessThanOrEqual(30);
  });

  test("shows on the third day to signed-out visitors, snoozes a week after Not now", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(shouldShowReturnPrompt({ visitDays: 2, signedIn: false, dismissedAt: null, now })).toBe(false);
    expect(shouldShowReturnPrompt({ visitDays: 3, signedIn: false, dismissedAt: null, now })).toBe(true);
    expect(shouldShowReturnPrompt({ visitDays: 5, signedIn: true, dismissedAt: null, now })).toBe(false);
    expect(shouldShowReturnPrompt({ visitDays: 5, signedIn: null, dismissedAt: null, now })).toBe(false);
    expect(shouldShowReturnPrompt({ visitDays: 5, signedIn: false, dismissedAt: now - 86_400_000, now })).toBe(false);
    expect(shouldShowReturnPrompt({ visitDays: 5, signedIn: false, dismissedAt: now - RETURN_PROMPT_SNOOZE_MS, now })).toBe(true);
  });

  test("the signup link sets up the trade and state and comes back to their bids", () => {
    const href = returnSignupHref("construction", "MA");
    const u = new URL(href, "https://www.contrax.company");
    expect(u.pathname).toBe("/signup");
    expect(u.searchParams.get("source")).toBe("radar");
    expect(u.searchParams.get("trade")).toBe("construction");
    expect(u.searchParams.get("state")).toBe("MA");
    expect(u.searchParams.get("next")).toBe("/radar?trade=construction&state=MA");
  });
});
