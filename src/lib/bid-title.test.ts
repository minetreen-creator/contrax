import { describe, expect, test } from "bun:test";
import { cleanBidTitle, fixTitleTypos, isCodeHeavyTitle } from "./bid-title";

describe("cleanBidTitle (owner 2026-10-04)", () => {
  test("strips PSC prefixes and leading reference numbers", () => {
    expect(cleanBidTitle("Z2DA--Project: 459-27-004 ACC MOD 2 Renovation")).toEqual({
      title: "ACC MOD 2 Renovation",
      reference: "459-27-004",
    });
    expect(cleanBidTitle("R606 Court Repoting Service").title).toBe("Court Repoting Service");
    expect(cleanBidTitle("S201--Custodial Services").title).toBe("Custodial Services");
  });

  test("all-caps titles become title case, keeping acronyms and (OR)", () => {
    expect(cleanBidTitle("54-TJK-08-PR39943, CUSTODIAL OPERATIONS AND MAINTENANCE OF REST AREAS/VISITOR INFORMATION CENTERS")).toEqual({
      title: "Custodial Operations and Maintenance of Rest Areas/Visitor Information Centers",
      reference: "54-TJK-08-PR39943",
    });
    expect(cleanBidTitle("Z2DA--561-26-104 REPAIR OPERATING ROOM (OR) & BATHROOM LEAKS").title).toBe(
      "Repair Operating Room (OR) & Bathroom Leaks",
    );
    expect(cleanBidTitle("HVAC MAINTENANCE FOR VA MEDICAL CENTER").title).toBe("HVAC Maintenance for VA Medical Center");
  });

  test("normal titles are untouched", () => {
    expect(cleanBidTitle("Window Shades and Installation Services")).toEqual({
      title: "Window Shades and Installation Services",
      reference: null,
    });
    expect(cleanBidTitle("")).toEqual({ title: "", reference: null });
  });

  test("never strips a title to nothing", () => {
    expect(cleanBidTitle("Z2DA--459-27-004").title).toBe("Z2DA--459-27-004");
  });
});

describe("isCodeHeavyTitle", () => {
  test("code soup is flagged, plain titles are not", () => {
    expect(isCodeHeavyTitle("6515-- | 2027 | CTX Home O2 S/O 36C257-27-AP-0386 674-27-1-573-0001")).toBe(true);
    expect(isCodeHeavyTitle("Window Shades and Installation Services")).toBe(false);
    expect(isCodeHeavyTitle("R606 Court Repoting Service")).toBe(false);
  });
});

import { foundingSpotsLine } from "~/components/FoundingOffer";
import { starterPriceHtml } from "./email";

describe("founding spots wording (owner 2026-10-04)", () => {
  test("no count until a spot is taken", () => {
    expect(foundingSpotsLine(10, 10)).toBe("Limited to the first 10 customers");
    expect(foundingSpotsLine(7, 10)).toBe("Only 7 of 10 spots left");
    expect(starterPriceHtml(10)).not.toContain("spots left");
    expect(starterPriceHtml(7)).toContain("only 7 spots left");
  });
});

import { isProductListingTitle } from "./sample-bids";

describe("product listings (owner 2026-10-04)", () => {
  test("2- to 4-digit FSC prefixes are product buys", () => {
    expect(isProductListingTitle("59--ACCESSORY KIT")).toBe(true);
    expect(isProductListingTitle("6515-- | 2027 | CTX Home O2")).toBe(true);
    expect(isProductListingTitle("S201--Custodial Services")).toBe(false);
  });
});

describe("fixTitleTypos", () => {
  test("fixes listed misspellings and keeps case", () => {
    expect(fixTitleTypos("Court Repoting Service")).toBe("Court Reporting Service");
    expect(fixTitleTypos("JANITORAL SERVIES")).toBe("JANITORIAL SERVICES");
    expect(fixTitleTypos("hvac maintanence")).toBe("hvac maintenance");
    expect(fixTitleTypos("Court Reporting Service")).toBe("Court Reporting Service");
  });
});
