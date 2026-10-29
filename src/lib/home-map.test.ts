import { describe, expect, test } from "bun:test";
import { HOME_MAP_SHADES, busiestState, categoryTrade, homeMapStates, lightUpOrder, shadeIndex } from "./home-map";
import type { ContractMapAggregate } from "./contract-map";

const agg = (states: Record<string, { count: number; closingSoon?: number; industries?: { name: string; count: number }[] }>) =>
  ({
    states: Object.fromEntries(
      Object.entries(states).map(([code, s]) => [code, { code, closingSoon: 0, industries: [], ...s }]),
    ),
    totals: {},
  }) as unknown as ContractMapAggregate;

describe("homepage state map", () => {
  test("shades: none for zero, darkest band for the busiest, small states still visible", () => {
    expect(shadeIndex(0, 1000)).toBe(0);
    expect(shadeIndex(1000, 1000)).toBe(HOME_MAP_SHADES.length - 1);
    expect(shadeIndex(10, 1000)).toBe(0);
    expect(shadeIndex(250, 1000)).toBe(2);
    expect(shadeIndex(5, 0)).toBe(0);
  });

  test("light-up order: busiest first, ties by code", () => {
    expect(lightUpOrder({ VA: 10, TX: 50, AK: 10 })).toEqual({ TX: 0, AK: 1, VA: 2 });
  });

  test("states: zero-count states dropped, 'Other' never shown as top work, top three kept", () => {
    const s = homeMapStates(
      agg({
        FL: { count: 900, closingSoon: 40, industries: [{ name: "Construction", count: 400 }, { name: "Other", count: 300 }, { name: "Janitorial", count: 50 }, { name: "HVAC", count: 20 }, { name: "Security", count: 5 }] },
        WY: { count: 0 },
      }),
    );
    expect(Object.keys(s)).toEqual(["FL"]);
    expect(s.FL.closingSoon).toBe(40);
    expect(s.FL.topWork.map((w) => w.name)).toEqual(["Construction", "Janitorial", "HVAC"]);
    expect(homeMapStates(null)).toEqual({});
    expect(busiestState(homeMapStates(agg({ VA: { count: 5 }, TX: { count: 9 } })))).toBe("TX");
    expect(busiestState({})).toBe("");
  });

  test("category chips search the Radar trade names", () => {
    expect(categoryTrade("Transportation")).toBe("Trucking");
    expect(categoryTrade("Security")).toBe("Security guards");
    expect(categoryTrade("Plumbing & Electrical")).toBe("Electrical");
    expect(categoryTrade("Construction")).toBe("Construction");
  });
});
