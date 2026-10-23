import { describe, expect, test } from "bun:test";
import { isExcludedPath, localDay, returnStage, withToday } from "./return-visitor";

const base = { visitDays: 1, hasEmail: false, signedIn: false, path: "/radar", slideClosedToday: false };

describe("returnStage", () => {
  test("first day: nothing; second: slide-up; third and later: gate", () => {
    expect(returnStage(base)).toBe("none");
    expect(returnStage({ ...base, visitDays: 2 })).toBe("slide");
    expect(returnStage({ ...base, visitDays: 3 })).toBe("gate");
    expect(returnStage({ ...base, visitDays: 9 })).toBe("gate");
  });
  test("a closed slide-up stays closed that day; the gate still comes on day 3", () => {
    expect(returnStage({ ...base, visitDays: 2, slideClosedToday: true })).toBe("none");
    expect(returnStage({ ...base, visitDays: 3, slideClosedToday: true })).toBe("gate");
  });
  test("never for people who left an email, are signed in, or are on excluded pages", () => {
    expect(returnStage({ ...base, visitDays: 5, hasEmail: true })).toBe("none");
    expect(returnStage({ ...base, visitDays: 5, signedIn: true })).toBe("none");
    for (const p of ["/login", "/signup?x=1", "/admin/live", "/post-checkout", "/privacy", "/unsubscribe"]) {
      expect(returnStage({ ...base, visitDays: 5, path: p })).toBe("none");
    }
  });
});

describe("visit days", () => {
  test("today is added once, junk dropped, oldest trimmed", () => {
    expect(withToday(["2026-10-20", "2026-10-20", "nope", 5], "2026-10-23")).toEqual(["2026-10-20", "2026-10-23"]);
    expect(withToday(null, "2026-10-23")).toEqual(["2026-10-23"]);
    const many = Array.from({ length: 40 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
    expect(withToday(many, "2026-10-23")).toHaveLength(30);
  });
  test("local day format", () => {
    expect(localDay(new Date(2026, 9, 3, 23, 0))).toBe("2026-10-03");
  });
  test("pages that are open", () => {
    expect(isExcludedPath("/")).toBe(false);
    expect(isExcludedPath("/subcontracts-in/nevada")).toBe(false);
    expect(isExcludedPath("/administrative")).toBe(false);
  });
});
