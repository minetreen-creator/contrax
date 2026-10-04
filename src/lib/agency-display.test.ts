import { describe, expect, test } from "bun:test";
import { displayAgency, displayLocation } from "./agency-display";

describe("displayAgency", () => {
  test("VA office codes say VA", () => {
    expect(displayAgency("256-NETWORK CONTRACT OFFICE 16 (36C256)")).toBe("VA Network Contract Office 16");
    expect(displayAgency("NETWORK CONTRACT OFFICE 7 (36C247)")).toBe("VA Network Contract Office 7");
    expect(displayAgency("STRATEGIC ACQUISITION CENTER (36C10G)")).toBe("VA Strategic Acquisition Center");
    expect(displayAgency("VA NETWORK CONTRACTING OFFICE 1 (36C241)")).toBe("VA Network Contracting Office 1");
  });

  test("other known department codes", () => {
    expect(displayAgency("FA4890 ACC AMIC (FA4890)")).toBe("Air Force FA4890 ACC AMIC");
    expect(displayAgency("DLA LAND AND MARITIME (SPE7MX)")).toBe("DLA Land and Maritime");
  });

  test("unknown codes keep their own words, never a guessed department", () => {
    expect(displayAgency("W7NR USPFO ACTIVITY WY ARNG (W912L1)")).toBe("W7NR USPFO ACTIVITY WY ARNG");
    expect(displayAgency("City of Chandler")).toBe("City of Chandler");
    expect(displayAgency("Department of Transportation")).toBe("Department of Transportation");
    expect(displayAgency("")).toBeNull();
    expect(displayAgency(null)).toBeNull();
  });
});

describe("displayLocation", () => {
  test("country-only locations are hidden", () => {
    expect(displayLocation("United States")).toBeNull();
    expect(displayLocation("USA")).toBeNull();
    expect(displayLocation("Jackson, MS")).toBe("Jackson, MS");
    expect(displayLocation(null)).toBeNull();
  });
});
