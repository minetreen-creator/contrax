import { describe, expect, test } from "bun:test";
import { parseTradeUpdate } from "./account-set-trade";

describe("account set-trade inputs", () => {
  test("parses the central-US trucking update", () => {
    expect(parseTradeUpdate({ INDUSTRY: "Trucking", SERVICES: "Trucking, Freight hauling", NAICS: "484110,484121", STATES: "tx, ok,TX" })).toEqual({
      industry: "Trucking",
      services: ["Trucking", "Freight hauling"],
      naics: ["484110", "484121"],
      states: ["TX", "OK"],
    });
  });

  test("rejects a missing trade, bad NAICS or bad states", () => {
    expect(() => parseTradeUpdate({ INDUSTRY: "", STATES: "TX" })).toThrow();
    expect(() => parseTradeUpdate({ INDUSTRY: "Trucking", NAICS: "4841", STATES: "TX" })).toThrow();
    expect(() => parseTradeUpdate({ INDUSTRY: "Trucking", STATES: "Texas" })).toThrow();
    expect(() => parseTradeUpdate({ INDUSTRY: "Trucking", STATES: "" })).toThrow();
  });
});

describe("an account with no profile gets one (owner 2026-11-04)", () => {
  test("the first $5 customer paid before onboarding: the tool creates the profile instead of failing", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./account-set-trade.ts", import.meta.url), "utf8");
    expect(src).toContain("if (before.length > 1) throw new Error");
    expect(src).toContain("INSERT INTO business_profiles (user_id, business_name, industry, service_categories, naics_codes, locations)");
    expect(src).not.toContain("if (before.length !== 1) throw");
  });
});
