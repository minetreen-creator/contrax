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
