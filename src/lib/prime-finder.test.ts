import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { approachTiming, introEmail, monthsUntil, sortPrimes, type PrimeRow } from "./prime-finder";

const prime = (o: Partial<PrimeRow>): PrimeRow => ({
  uei: "U", name: "Acme Facility Services", parent: null, contracts: 1, value: 1e6, agencies: ["Department of Defense"], nextEnd: "2027-06-30", hasPlan: false, planType: null, ...o,
});

describe("prime contractor finder", () => {
  test("primes that must subcontract come first, then the biggest holders", () => {
    const out = sortPrimes([
      prime({ uei: "a", name: "Big No Plan", value: 50e6 }),
      prime({ uei: "b", name: "Plan Small", value: 2e6, hasPlan: true }),
      prime({ uei: "c", name: "Plan Big", value: 9e6, hasPlan: true }),
    ]);
    expect(out.map((p) => p.uei)).toEqual(["c", "b", "a"]);
  });

  test("approach timing: 3 to 12 months out is the time to ask about the rebid team", () => {
    const now = new Date("2026-11-09T00:00:00Z");
    expect(monthsUntil("2027-05-31", now)).toBe(6);
    expect(approachTiming("2027-05-31", now).tone).toBe("now");
    expect(approachTiming("2026-12-15", now).tone).toBe("late");
    expect(approachTiming("2028-03-01", now).tone).toBe("soon");
    expect(approachTiming(null, now).tone).toBe("later");
  });

  test("the intro email uses only the member's own profile and leaves blanks to fill", () => {
    const filled = introEmail(prime({}), "Janitorial", "Virginia", {
      businessName: "Shine Co", services: ["janitorial", "floor care"], certifications: ["sdvosb"], yearsInBusiness: 6, pastPerformance: "Nightly cleaning for a VA clinic.",
    });
    expect(filled.subject).toBe("Shine Co: Service-Disabled Veteran-Owned Small Business subcontractor for janitorial in Virginia");
    expect(filled.body).toContain("Hello Acme Facility Services small business team,");
    expect(filled.body).toContain("Shine Co is a Service-Disabled Veteran-Owned Small Business (SDVOSB) business providing janitorial, floor care services in Virginia.");
    expect(filled.body).toContain("for the Department of Defense");
    expect(filled.body).toContain("We have been in business 6 years.");
    const blank = introEmail(prime({ agencies: [] }), "Janitorial", "Virginia", {});
    expect(blank.body).toContain("[your business name] is a small business providing janitorial services in Virginia.");
    expect(blank.body).toContain("[One or two recent jobs similar to this work.]");
    expect(blank.body).not.toContain("for the ");
  });
});

test("the finder is linked from the gap map, recompetes and subcontracts pages, gated like recompetes, and in the sitemap", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  expect(read("../routes/gap-map.tsx")).toContain("/prime-finder?trade=${trade}&state=${s.state}");
  expect(read("../routes/recompetes.tsx")).toContain('href="/prime-finder"');
  expect(read("../routes/subcontracts.tsx")).toContain('href="/prime-finder"');
  expect(read("../../scripts/generate-sitemap.mjs")).toContain('["/prime-finder", "weekly", "0.6"]');
  const route = read("../routes/prime-finder.tsx");
  expect(route).toContain("rows: all.slice(0, hasAccess ? FULL_LIMIT : PREVIEW_ROWS)");
  expect(route).toContain("Contrax does not contact primes for you.");
});
