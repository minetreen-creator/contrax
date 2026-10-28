import { describe, expect, test } from "bun:test";
import { normalizeStateInput, resolveBidState, resolveStateFromText } from "./location-state";
import { deriveStateCode, STATE_NAMES } from "./contract-map";
import { shouldApplyStateFilter } from "./open-bids";
import { US_PLACES, US_STATES, US_TERRITORIES } from "./states";
import { REGION_SET } from "./seo-landing";

// Owner 2026-10-28: "What about the US territories" → "Do them all".
describe("US territories", () => {
  test("are searchable places but not states", () => {
    expect(US_STATES).toHaveLength(51);
    expect([...US_PLACES]).toEqual([...US_STATES, "PR", "GU", "VI", "AS", "MP"]);
    for (const t of US_TERRITORIES) {
      expect(STATE_NAMES[t]).toBeTruthy();
      expect(REGION_SET.has(t)).toBe(true);
    }
    expect(STATE_NAMES.VI).toBe("US Virgin Islands");
  });

  test("resolve from full names and the 'City, XX' form", () => {
    expect(resolveStateFromText("San Juan, PR")).toBe("PR");
    expect(resolveStateFromText("Puerto Rico")).toBe("PR");
    expect(resolveStateFromText("Andersen AFB, Guam")).toBe("GU");
    expect(resolveStateFromText("St. Thomas, VI 00802")).toBe("VI");
    expect(resolveStateFromText("Pago Pago, American Samoa")).toBe("AS");
    expect(resolveStateFromText("Saipan, Northern Mariana Islands")).toBe("MP");
    expect(normalizeStateInput("Puerto Rico")).toBe("PR");
    expect(normalizeStateInput("gu")).toBe("GU");
    expect(deriveStateCode("Barrigada, GU")).toBe("GU");
  });

  test("bare territory codes in other text are not places", () => {
    expect(resolveStateFromText("PR 12345 office supplies")).toBeNull();
    expect(resolveBidState(null, "EPA REGION VI")).toBeNull();
    expect(resolveStateFromText("AS needed")).toBeNull();
    // A real state code still resolves as before.
    expect(resolveStateFromText("Norfolk VA")).toBe("VA");
  });

  test("selecting every state is still nationwide", () => {
    expect(shouldApplyStateFilter([...US_STATES])).toBe(false);
    expect(shouldApplyStateFilter([...US_PLACES])).toBe(false);
    expect(shouldApplyStateFilter(["PR"])).toBe(true);
  });
});
