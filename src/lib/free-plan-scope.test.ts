/**
 * Free plan scope (profile-match.ts scopeProfileToPlan): a free account's
 * matching follows one state and one trade; paid accounts keep everything.
 */
import { describe, expect, test } from "bun:test";
import { freePlanScopeMessage, scopeProfileToPlan } from "./profile-match";

const PROFILE = {
  business_name: "Acme",
  locations: ["OH", "KY", "Indiana"],
  naics_codes: ["561720", "238220"],
  industry: "janitorial",
  service_categories: ["cleaning"],
};

describe("scopeProfileToPlan", () => {
  test("paid accounts keep every state and trade", () => {
    const r = scopeProfileToPlan(PROFILE, true);
    expect(r.profile).toBe(PROFILE);
    expect(r.scope).toBeNull();
  });

  test("free accounts match the first state and the first NAICS code; the input is not modified", () => {
    const r = scopeProfileToPlan(PROFILE, false);
    expect(r.profile!.locations).toEqual(["OH"]);
    expect(r.profile!.naics_codes).toEqual(["561720"]);
    expect(r.profile!.business_name).toBe("Acme");
    expect(r.scope).toEqual({ limited: true, totalStates: 3, totalTrades: 2, followedStates: ["OH"], followedTrades: ["561720"] });
    expect(PROFILE.locations).toEqual(["OH", "KY", "Indiana"]);
    expect(PROFILE.naics_codes).toEqual(["561720", "238220"]);
  });

  test("without NAICS codes the typed service categories are the trades", () => {
    const r = scopeProfileToPlan({ locations: ["TX"], naics_codes: [], service_categories: ["roofing", "gutters"] }, false);
    expect(r.profile!.service_categories).toEqual(["roofing"]);
    expect(r.profile!.locations).toEqual(["TX"]);
    expect(r.scope!.limited).toBe(true);
    expect(r.scope!.totalTrades).toBe(2);
  });

  test("a free profile already within one state and one trade is not limited; no states stays nationwide", () => {
    expect(scopeProfileToPlan({ locations: ["VA"], naics_codes: ["561720"] }, false).scope!.limited).toBe(false);
    const nationwide = scopeProfileToPlan({ locations: [], naics_codes: ["561720"] }, false);
    expect(nationwide.profile!.locations).toEqual([]);
    expect(nationwide.scope!.limited).toBe(false);
    expect(scopeProfileToPlan(null, false)).toEqual({ profile: null, scope: null });
  });
});

describe("freePlanScopeMessage", () => {
  test("names what Basic follows and what Starter adds", () => {
    const { scope } = scopeProfileToPlan(PROFILE, false);
    expect(freePlanScopeMessage(scope!, (t) => (t === "561720" ? "Janitorial Services" : t))).toBe(
      "Basic matches 1 state and 1 trade (OH, Janitorial Services). Starter matches all 3 of your states and all 2 of your trades.",
    );
    const statesOnly = scopeProfileToPlan({ locations: ["OH", "KY"], naics_codes: ["561720"] }, false).scope!;
    expect(freePlanScopeMessage(statesOnly)).toBe("Basic matches 1 state and 1 trade (OH, 561720). Starter matches all 2 of your states.");
  });
});
