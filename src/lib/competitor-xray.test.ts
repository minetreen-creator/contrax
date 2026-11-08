import { describe, expect, test } from "bun:test";
import { cleanXrayQuery, summarizeXray, xrayLikePattern, type XrayContractRow } from "./competitor-xray";

// Owner 2026-11-08: "Who is winning in [State]?" competitor lookup.
const NOW = Date.parse("2026-11-08T12:00:00Z");
const row = (o: Partial<XrayContractRow>): XrayContractRow => ({
  award_key: "a1", recipient_name: "ACME FACILITY SERVICES LLC", amount: 100000, start_date: "2025-01-01", end_date: "2027-03-31",
  agency: "Department of Veterans Affairs", sub_agency: null, description: "Janitorial services", pop_state: "VA", ...o,
});

describe("competitor x-ray", () => {
  test("query cleaning and a literal LIKE pattern", () => {
    expect(cleanXrayQuery("  acme   facility ")).toBe("acme facility");
    expect(cleanXrayQuery("ab")).toBeNull();
    expect(cleanXrayQuery("x".repeat(81))).toBeNull();
    expect(xrayLikePattern("100%_co")).toBe("%100\\%\\_co%");
  });

  test("one contract per award; totals, expiring within a year, top names and states", () => {
    const { summary, contracts } = summarizeXray("acme", [
      row({}),
      row({ award_key: "a1" }), // same award under a second trade
      row({ award_key: "a2", amount: "250000", end_date: "2030-01-01", pop_state: "MD" }),
      row({ award_key: "a3", amount: null, end_date: "2026-12-15", recipient_name: "ACME CORP" }),
    ], NOW);
    expect(summary).toEqual({
      query: "acme",
      names: ["ACME FACILITY SERVICES LLC", "ACME CORP"],
      contracts: 3,
      totalValue: 350000,
      expiringSoon: 2,
      states: ["VA", "MD"],
    });
    expect(contracts.map((c) => c.end)).toEqual(["2026-12-15", "2027-03-31", "2030-01-01"]);
  });

  test("nothing found is an honest zero", () => {
    expect(summarizeXray("nobody", [], NOW).summary).toMatchObject({ contracts: 0, totalValue: 0, expiringSoon: 0, names: [] });
  });
});
