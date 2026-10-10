import { describe, expect, test } from "bun:test";
import { deriveStateCode, buildContractMap } from "~/lib/contract-map";

describe("map state attribution", () => {
  test("West Virginia is not Virginia", () => {
    expect(deriveStateCode("West Virginia")).toBe("WV");
    expect(deriveStateCode("Charleston, West Virginia")).toBe("WV");
    expect(deriveStateCode("Virginia")).toBe("VA");
    expect(deriveStateCode("Richmond, Virginia")).toBe("VA");
    expect(deriveStateCode("Charleston, WV")).toBe("WV");
    expect(deriveStateCode("Richmond, VA")).toBe("VA");
  });

  test("state aggregates keep West Virginia bids out of Virginia", () => {
    const rows = [
      { location: "West Virginia", set_aside: null, estimated_value: null, agency: "WV agency", category: "Transportation", due_date: null },
      { location: "Richmond, Virginia", set_aside: null, estimated_value: null, agency: "VA agency", category: "Transportation", due_date: null },
    ];
    const map = buildContractMap(rows);
    expect(map.states.WV?.count).toBe(1);
    expect(map.states.VA?.count).toBe(1);
  });
});
