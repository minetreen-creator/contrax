import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { profileFromSearches } from "./profile-seed";
import { seedProfileFromSearches } from "./profile-seed.server";

// Owner 2026-11-04: "people aren't filling out their trades". The first $5
// customer searched "Flooring · WA" and got an account with no trade.
describe("trade from the visitor's search", () => {
  test("the latest search that found bids becomes the profile", () => {
    expect(profileFromSearches([{ trade: "Flooring", state: "WA", matched: 6 }])).toEqual({ industry: "Flooring", naicsCodes: [], locations: ["WA"] });
    expect(
      profileFromSearches([
        { trade: "plumbing", state: "TX", matched: 0 },
        { trade: "Landscaping", state: "TX", matched: 25 },
      ]),
    ).toEqual({ industry: "Landscaping", naicsCodes: [], locations: ["TX"] });
  });
  test("addresses and emails are never a trade; with nothing usable there is no profile", () => {
    expect(profileFromSearches([{ trade: "6511EastLauraCircle", state: "TX", matched: 0 }, { trade: "someone@gmail.com", state: "", matched: 0 }])).toBeNull();
    expect(profileFromSearches([])).toBeNull();
    expect(profileFromSearches([{ trade: "6511EastLauraCircle", state: "TX", matched: 0 }, { trade: "construction", state: "TX", matched: 64 }])?.industry).toBe("Construction");
  });
  test("a NAICS code search saves the code and its name; no state means no state filter", () => {
    expect(profileFromSearches([{ trade: "238150", state: "OH", matched: 0 }])).toEqual({ industry: "Glass and Glazing Contractors", naicsCodes: ["238150"], locations: ["OH"] });
    expect(profileFromSearches([{ trade: "Janitorial", state: "", matched: 25 }])?.locations).toEqual([]);
  });
  test("an account that already has a profile is left alone", async () => {
    const calls: string[] = [];
    const db = () => async (strings: TemplateStringsArray) => {
      calls.push(strings.join("?"));
      return strings.join("").includes("FROM business_profiles") ? [{ "?column?": 1 }] : [];
    };
    expect(await seedProfileFromSearches(db as any, 7, "3f2b9c1e-1111-4a2b-9c3d-123456789abc")).toBe(false);
    expect(calls.some((c) => c.includes("INSERT"))).toBe(false);
    expect(await seedProfileFromSearches(db as any, 7, "bad id!")).toBe(false);
  });
  test("every account door seeds the profile: signups and OAuth (shared backfill) and pay-first checkout", () => {
    expect(readFileSync("src/lib/identity-backfill.ts", "utf8")).toContain("await seedProfileFromSearches(db, userId, visitorId);");
    expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("await seedProfileFromSearches(dbFactory, Number(userId), session.metadata.visitor_id);");
  });
});
