import { describe, expect, test } from "bun:test";
import { splitTradeAndPlace } from "./trade-place";

describe("a place typed into the trade box", () => {
  test("the search that found nothing: a city in front of the trade", () => {
    expect(splitTradeAndPlace("Jacksonville concrete", "")).toEqual({ trade: "concrete", state: "FL", place: "Jacksonville, FL" });
  });

  test("a city or a state after the trade, with or without a joining word", () => {
    expect(splitTradeAndPlace("concrete in Florida", "")).toEqual({ trade: "concrete", state: "FL", place: "Florida" });
    expect(splitTradeAndPlace("plumbing Houston", "")).toMatchObject({ trade: "plumbing", state: "TX" });
    expect(splitTradeAndPlace("roofing near Tampa area", "")).toMatchObject({ trade: "roofing", state: "FL" });
    expect(splitTradeAndPlace("new york roofing", "")).toMatchObject({ trade: "roofing", state: "NY" });
    expect(splitTradeAndPlace("snow removal North Carolina", "")).toMatchObject({ trade: "snow removal", state: "NC" });
    expect(splitTradeAndPlace("Washington DC paving", "")).toMatchObject({ trade: "paving", state: "DC" });
    expect(splitTradeAndPlace("Washington paving", "")).toMatchObject({ trade: "paving", state: "WA" });
  });

  test("a city with its state code", () => {
    expect(splitTradeAndPlace("Houston, TX plumbing", "")).toMatchObject({ trade: "plumbing", state: "TX" });
    expect(splitTradeAndPlace("plumbing Houston TX", "")).toMatchObject({ trade: "plumbing", state: "TX" });
  });

  test("a bare state code counts after the trade, not when it is just a word", () => {
    expect(splitTradeAndPlace("hvac TX", "")).toMatchObject({ trade: "hvac", state: "TX" });
    expect(splitTradeAndPlace("hvac tx", "")).toMatchObject({ trade: "hvac", state: "TX" });
    expect(splitTradeAndPlace("roofing IN", "")).toMatchObject({ trade: "roofing", state: "IN" });
    expect(splitTradeAndPlace("roofing in", "").place).toBeNull();
    expect(splitTradeAndPlace("painting or", "").place).toBeNull();
  });

  test("the state box: a typed state replaces it, a typed city does not", () => {
    expect(splitTradeAndPlace("concrete Florida", "GA")).toMatchObject({ trade: "concrete", state: "FL" });
    expect(splitTradeAndPlace("Jacksonville concrete", "TX")).toMatchObject({ trade: "concrete", state: "TX" });
  });

  test("left exactly as typed when there is no place, or what is left is not a trade", () => {
    expect(splitTradeAndPlace("concrete", "FL")).toEqual({ trade: "concrete", state: "FL", place: null });
    expect(splitTradeAndPlace("snow removal", "")).toEqual({ trade: "snow removal", state: "", place: null });
    expect(splitTradeAndPlace("mobile home", "").place).toBeNull();
    expect(splitTradeAndPlace("Jacksonville", "").place).toBeNull();
    expect(splitTradeAndPlace("Houston Smith LLC", "").place).toBeNull();
    expect(splitTradeAndPlace("", "VA")).toEqual({ trade: "", state: "VA", place: null });
    expect(splitTradeAndPlace("238110", "")).toEqual({ trade: "238110", state: "", place: null });
  });
});
