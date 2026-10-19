import { describe, expect, test } from "bun:test";
import { bidAlertProfile, tradeAlertProfile } from "./bid-alert";

describe("bid page match-alert profile (owner 2026-10-15)", () => {
  test("NAICS and state from the bid", () => {
    const p = bidAlertProfile({ naics_code: "541512", state_code: "MO" });
    expect(p).toEqual({ trade: "541512", state: "MO", label: "Computer Systems Design Services bids in Missouri" });
  });
  test("state only when the bid has no NAICS", () => {
    expect(bidAlertProfile({ naics_code: null, state_code: "SD" })).toEqual({ trade: null, state: "SD", label: "New bids in South Dakota" });
  });
  test("NAICS only when the state is unknown", () => {
    expect(bidAlertProfile({ naics_code: "561720", state_code: null })?.trade).toBe("561720");
  });
  test("no offer when neither is known, or the values are malformed", () => {
    expect(bidAlertProfile({ naics_code: null, state_code: null })).toBeNull();
    expect(bidAlertProfile({ naics_code: "54", state_code: "ZZ" })).toBeNull();
  });
});

describe("tradeAlertProfile (/recompetes)", () => {
  const janitorial = { radarTerm: "janitorial", label: "Janitorial" };
  test("uses the trade's Radar term and the chosen state", () => {
    expect(tradeAlertProfile(janitorial, "RI")).toEqual({ trade: "janitorial", state: "RI", label: "New janitorial bids in Rhode Island" });
  });
  test("works nationwide and ignores an unknown state", () => {
    expect(tradeAlertProfile(janitorial, null)).toEqual({ trade: "janitorial", state: null, label: "New janitorial bids" });
    expect(tradeAlertProfile(janitorial, "XX")?.state).toBeNull();
  });
  test("no trade, no offer", () => {
    expect(tradeAlertProfile(undefined, "RI")).toBeNull();
  });
});
