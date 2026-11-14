import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { profileFromAnswer, profileFromSearches } from "./profile-seed";
import { seedProfileFromAnswer, seedProfileFromSearches } from "./profile-seed.server";

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

// Owner 2026-11-14: half of new accounts still had no trade (they never
// searched first), so the signup form asks for trade and state.
describe("trade and state typed on the signup form", () => {
  test("the answer becomes the profile, by the same rules as a search", () => {
    expect(profileFromAnswer("roofing", "tn")).toEqual({ industry: "Roofing", naicsCodes: [], locations: ["TN"] });
    expect(profileFromAnswer("238150", "OH")).toEqual({ industry: "Glass and Glazing Contractors", naicsCodes: ["238150"], locations: ["OH"] });
    expect(profileFromAnswer("someone@gmail.com", "TN")).toBeNull();
    expect(profileFromAnswer("", "TN")).toBeNull();
    expect(profileFromAnswer("Janitorial", "Tennessee")?.locations).toEqual([]);
  });
  test("a new account gets the profile; one that already has a profile is left alone", async () => {
    const run = async (hasProfile: boolean) => {
      const calls: string[] = [];
      const db = () => async (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return hasProfile && strings.join("").includes("SELECT 1 FROM business_profiles") ? [{ "?column?": 1 }] : [];
      };
      const saved = await seedProfileFromAnswer(db as any, 7, "Janitorial", "VA");
      return { saved, inserted: calls.some((c) => c.includes("INSERT INTO business_profiles")) };
    };
    expect(await run(false)).toEqual({ saved: true, inserted: true });
    expect(await run(true)).toEqual({ saved: false, inserted: false });
    expect(await seedProfileFromAnswer((() => { throw new Error("db down"); }) as any, 7, "Janitorial", "VA")).toBe(false);
  });
  test("the form requires both, sends them, and the server saves them before the search-based guess", () => {
    const form = readFileSync("src/routes/signup.tsx", "utf8");
    expect(form).toContain('clientErrors.push("Tell us what kind of work you do.");');
    expect(form).toContain('clientErrors.push("Choose your state.");');
    expect(form).toContain("trade: signupTrade,");
    expect(form).toContain("state: signupState,");
    const api = readFileSync("src/routes/api/signup.ts", "utf8");
    expect(api.indexOf("seedProfileFromAnswer(sql, user.id, signupTrade, signupState)")).toBeGreaterThan(0);
    expect(api.indexOf("seedProfileFromAnswer(sql, user.id, signupTrade, signupState)")).toBeLessThan(api.indexOf("await backfillFunnelIdentity(user.id, user.email, visitorId);"));
  });
});
