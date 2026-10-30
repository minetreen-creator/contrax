import { describe, expect, test } from "bun:test";
import { companyDisplayName, orderForState, shortAmount, subLeadTrade, type SubLead } from "./sub-leads";

const lead = (workState: string, recipient = "ACME LLC"): SubLead => ({
  recipient, recipientCity: "TAMPA", recipientState: "FL", workState, amount: 100_000, agency: null, naics: "561720", awardedOn: "2026-10-28",
});

describe("homepage subcontracting leads (owner 2026-10-30)", () => {
  test("company names read naturally", () => {
    expect(companyDisplayName("EXCELSIOR DEFENSE, INC")).toBe("Excelsior Defense, INC");
    expect(companyDisplayName("DIDLAKE INC")).toBe("Didlake INC");
    expect(companyDisplayName("Viking Pest Control")).toBe("Viking Pest Control");
    expect(companyDisplayName("JLL USA LLC")).toBe("JLL USA LLC");
    expect(companyDisplayName("CBG-PEGASUS JV, LLC")).toBe("CBG-Pegasus JV, LLC");
  });

  test("amounts and trades", () => {
    expect(shortAmount(2_867_232)).toBe("$2.9M");
    expect(shortAmount(11_166_791)).toBe("$11M");
    expect(shortAmount(352_950)).toBe("$353K");
    expect(subLeadTrade("561730")).toBe("landscaping");
    expect(subLeadTrade("999999")).toBe("service");
  });

  test("the visitor's state comes first", () => {
    const list = [lead("TX", "A"), lead("GA", "B"), lead("TX", "C")];
    expect(orderForState(list, "GA").map((l) => l.recipient)).toEqual(["B", "A", "C"]);
    expect(orderForState(list, null).map((l) => l.recipient)).toEqual(["A", "B", "C"]);
  });
});
